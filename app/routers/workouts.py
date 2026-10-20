from collections import defaultdict
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

from fastapi import APIRouter, Query, Response

from ..db import pool
from ..errors import ApiError
from ..schemas.common import IsoDate
from ..schemas.errors import ERROR_RESPONSES
from ..schemas.workouts import SetIn, SetPatch, WorkoutCreate, WorkoutOut, WorkoutPatch

router = APIRouter(prefix="/workouts", tags=["workouts"], responses=ERROR_RESPONSES)

CENT = Decimal("0.01")
# Constant column list (never user input). "day" is exposed as "date".
WORKOUT_COLS = "id, day AS date, started_at, ended_at, name, notes"
WORKOUT_UPDATABLE = {"ended_at", "name", "notes"}
SET_UPDATABLE = {"exercise_id", "weight_lbs", "reps", "notes"}


# ---------------------------------------------------------------- helpers

def to_decimal(x: float) -> Decimal:
    return Decimal(str(x)).quantize(CENT, rounding=ROUND_HALF_UP)


def attach_sets(conn, workouts: list) -> list:
    if not workouts:
        return workouts
    # The exercise name is joined in (not copied), so renaming an exercise
    # renames it everywhere, history included.
    rows = conn.execute(
        "SELECT s.workout_id, s.id, s.position, s.exercise_id, e.name AS exercise, "
        "s.weight_lbs, s.reps, s.notes "
        "FROM sets s JOIN exercises e ON e.id = s.exercise_id "
        "WHERE s.workout_id = ANY(%s) ORDER BY s.position",
        ([w["id"] for w in workouts],),
    ).fetchall()
    by_workout = defaultdict(list)
    for r in rows:
        by_workout[r["workout_id"]].append(r)
    for w in workouts:
        w["sets"] = by_workout[w["id"]]
    return workouts


def load_workout(conn, workout_id: UUID):
    row = conn.execute(
        "SELECT " + WORKOUT_COLS + " FROM workouts WHERE id = %s", (workout_id,)
    ).fetchone()
    if row is None:
        return None
    return attach_sets(conn, [row])[0]


def check_exercise(conn, exercise_id: UUID) -> None:
    """The exercise must exist and be active. FOR SHARE: it can't be archived
    by someone else until our transaction ends."""
    row = conn.execute(
        "SELECT name, archived FROM exercises WHERE id = %s FOR SHARE", (exercise_id,)
    ).fetchone()
    if row is None:
        raise ApiError(400, "unknown_exercise", f"No exercise with id {exercise_id}")
    if row["archived"]:
        raise ApiError(400, "exercise_archived", f"'{row['name']}' is archived")


def add_set(conn, workout_id: UUID, body: SetIn) -> bool:
    """Append a set. True = created; False = same id and same content already saved (a retry).
    The caller must hold the workout's row lock."""
    stored = conn.execute(
        "SELECT workout_id, exercise_id, weight_lbs, reps, notes FROM sets WHERE id = %s",
        (body.id,),
    ).fetchone()
    if stored is not None:
        same = (
            stored["workout_id"] == workout_id
            and stored["exercise_id"] == body.exercise_id
            and stored["weight_lbs"] == to_decimal(body.weight_lbs)
            and stored["reps"] == body.reps
            and stored["notes"] == body.notes
        )
        if not same:
            raise ApiError(409, "idempotency_conflict", "This id was already used for a different set")
        return False

    # Only new sets are checked, so replaying an old request still works
    # even if its exercise has been archived since.
    check_exercise(conn, body.exercise_id)
    position = conn.execute(
        "SELECT COALESCE(MAX(position), 0) + 1 AS p FROM sets WHERE workout_id = %s",
        (workout_id,),
    ).fetchone()["p"]
    conn.execute(
        "INSERT INTO sets (id, workout_id, position, exercise_id, weight_lbs, reps, notes) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s)",
        (
            body.id,
            workout_id,
            position,
            body.exercise_id,
            to_decimal(body.weight_lbs),
            body.reps,
            body.notes,
        ),
    )
    return True


# ---------------------------------------------------------------- workouts

@router.post("", response_model=WorkoutOut, status_code=201)
def start_workout(body: WorkoutCreate, response: Response):
    # The workout's date is the calendar date in the offset the client sent.
    day = body.started_at.date()
    with pool.connection() as conn:
        inserted = conn.execute(
            "INSERT INTO workouts (id, started_at, day, name, notes) "
            "VALUES (%s, %s, %s, %s, %s) ON CONFLICT (id) DO NOTHING RETURNING id",
            (body.id, body.started_at, day, body.name, body.notes),
        ).fetchone()
        if inserted is None:
            # Id already exists: a retry, or a clash. Compare, don't re-insert.
            stored = conn.execute(
                "SELECT started_at, name, notes FROM workouts WHERE id = %s", (body.id,)
            ).fetchone()
            same = (
                stored is not None
                and stored["started_at"] == body.started_at
                and stored["name"] == body.name
                and stored["notes"] == body.notes
            )
            if not same:
                raise ApiError(
                    409, "idempotency_conflict", "This id was already used for a different workout"
                )
            response.status_code = 200
        return load_workout(conn, body.id)


@router.get("", response_model=list[WorkoutOut])
def list_workouts(
    day: IsoDate | None = Query(default=None, alias="date"),
    from_: IsoDate | None = Query(default=None, alias="from"),
    to: IsoDate | None = None,
    open_only: bool = Query(False, alias="open"),
    limit: int = Query(50, ge=1, le=200),
):
    if day is not None and (from_ is not None or to is not None):
        raise ApiError(400, "validation_failed", "Use either 'date' or 'from' and 'to', not both")
    if (from_ is None) != (to is None):
        raise ApiError(400, "validation_failed", "'from' and 'to' must be given together")

    sql = "SELECT " + WORKOUT_COLS + " FROM workouts WHERE true"
    params: list = []
    if day is not None:
        sql += " AND day = %s"
        params.append(day)
    elif from_ is not None:
        if to < from_:
            raise ApiError(400, "validation_failed", "'to' must not be before 'from'")
        if (to - from_).days > 366:
            raise ApiError(400, "validation_failed", "Range is limited to 366 days")
        sql += " AND day BETWEEN %s AND %s"
        params += [from_, to]
    if open_only:
        sql += " AND ended_at IS NULL"  # workouts you haven't ended yet
    sql += " ORDER BY started_at DESC LIMIT %s"  # newest first; no filter = latest workouts
    params.append(limit)

    with pool.connection() as conn:
        return attach_sets(conn, conn.execute(sql, params).fetchall())


@router.get("/{workout_id}", response_model=WorkoutOut)
def get_workout(workout_id: UUID):
    with pool.connection() as conn:
        workout = load_workout(conn, workout_id)
    if workout is None:
        raise ApiError(404, "not_found", "Workout not found")
    return workout


@router.patch("/{workout_id}", response_model=WorkoutOut)
def update_workout(workout_id: UUID, body: WorkoutPatch):
    changes = body.model_dump(exclude_unset=True)  # includes explicit nulls (clear / reopen)
    # Column names in the SQL come from this whitelist, never from user input.
    assert set(changes) <= WORKOUT_UPDATABLE
    assignments = ", ".join(col + " = %s" for col in changes)
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT started_at FROM workouts WHERE id = %s FOR UPDATE", (workout_id,)
        ).fetchone()
        if row is None:
            raise ApiError(404, "not_found", "Workout not found")
        ended_at = changes.get("ended_at")
        if ended_at is not None and ended_at < row["started_at"]:
            raise ApiError(400, "validation_failed", "ended_at must not be before started_at")
        conn.execute(
            "UPDATE workouts SET " + assignments + " WHERE id = %s",
            list(changes.values()) + [workout_id],
        )
        return load_workout(conn, workout_id)


@router.delete("/{workout_id}", status_code=204)
def delete_workout(workout_id: UUID):
    # ON DELETE CASCADE removes its sets. Idempotent: always 204.
    with pool.connection() as conn:
        conn.execute("DELETE FROM workouts WHERE id = %s", (workout_id,))
    return Response(status_code=204)


# ---------------------------------------------------------------- sets

@router.post("/{workout_id}/sets", response_model=WorkoutOut, status_code=201)
def add_set_to_workout(workout_id: UUID, body: SetIn, response: Response):
    with pool.connection() as conn:
        # Lock the workout: appends (and retries) to it run one at a time,
        # so positions can't collide.
        locked = conn.execute(
            "SELECT 1 FROM workouts WHERE id = %s FOR UPDATE", (workout_id,)
        ).fetchone()
        if locked is None:
            raise ApiError(404, "not_found", "Workout not found")
        if not add_set(conn, workout_id, body):
            response.status_code = 200
        return load_workout(conn, workout_id)


@router.patch("/{workout_id}/sets/{set_id}", response_model=WorkoutOut)
def update_set(workout_id: UUID, set_id: UUID, body: SetPatch):
    changes = body.model_dump(exclude_unset=True)
    if "weight_lbs" in changes:
        changes["weight_lbs"] = to_decimal(changes["weight_lbs"])
    assert set(changes) <= SET_UPDATABLE
    assignments = ", ".join(col + " = %s" for col in changes)
    with pool.connection() as conn:
        if "exercise_id" in changes:
            check_exercise(conn, changes["exercise_id"])
        row = conn.execute(
            "UPDATE sets SET " + assignments + " WHERE id = %s AND workout_id = %s RETURNING id",
            list(changes.values()) + [set_id, workout_id],
        ).fetchone()
        if row is None:
            raise ApiError(404, "not_found", "Set not found")
        return load_workout(conn, workout_id)


@router.delete("/{workout_id}/sets/{set_id}", status_code=204)
def delete_set(workout_id: UUID, set_id: UUID):
    with pool.connection() as conn:
        conn.execute("DELETE FROM sets WHERE id = %s AND workout_id = %s", (set_id, workout_id))
    return Response(status_code=204)
