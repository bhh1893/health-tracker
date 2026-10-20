from uuid import UUID, uuid4

from fastapi import APIRouter, Query, Response
from psycopg.errors import UniqueViolation

from ..db import pool
from ..errors import ApiError
from ..schemas.errors import ERROR_RESPONSES
from ..schemas.exercises import ExerciseCreate, ExerciseOut, ExerciseUpdate

router = APIRouter(prefix="/exercises", tags=["exercises"], responses=ERROR_RESPONSES)

# Module-level constants only; values always go through %s placeholders.
COLUMNS = "id, name, muscle_area, archived, updated_at"
UPDATABLE = {"name", "muscle_area", "archived"}


def like_pattern(q: str) -> str:
    """Turn user text into a contains-pattern, escaping LIKE's own wildcards."""
    escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


@router.post("", response_model=ExerciseOut, status_code=201)
def create_exercise(body: ExerciseCreate):
    try:
        with pool.connection() as conn:
            row = conn.execute(
                "INSERT INTO exercises (id, name, muscle_area) VALUES (%s, %s, %s) "
                "RETURNING " + COLUMNS,
                (uuid4(), body.name, body.muscle_area),
            ).fetchone()
    except UniqueViolation:
        raise ApiError(409, "duplicate_name", f"An active exercise named '{body.name}' already exists")
    return row


@router.get("", response_model=list[ExerciseOut])
def list_exercises(
    q: str | None = None,
    include_archived: bool = False,
    limit: int = Query(50, ge=1, le=200),
):
    sql = "SELECT " + COLUMNS + " FROM exercises WHERE true"
    params: list = []
    if q:
        # Matches the name or the muscle/area note, so "bicep" finds your curls.
        sql += " AND (name ILIKE %s OR muscle_area ILIKE %s)"
        pattern = like_pattern(q)
        params += [pattern, pattern]
    if not include_archived:
        sql += " AND NOT archived"
    sql += " ORDER BY lower(name) LIMIT %s"
    params.append(limit)
    with pool.connection() as conn:
        return conn.execute(sql, params).fetchall()


@router.get("/{exercise_id}", response_model=ExerciseOut)
def get_exercise(exercise_id: UUID):
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT " + COLUMNS + " FROM exercises WHERE id = %s", (exercise_id,)
        ).fetchone()
    if row is None:
        raise ApiError(404, "not_found", "Exercise not found")
    return row


@router.patch("/{exercise_id}", response_model=ExerciseOut)
def update_exercise(exercise_id: UUID, body: ExerciseUpdate):
    changes = body.model_dump(exclude_unset=True)  # includes an explicit muscle_area null
    # Column names in the SQL come from this whitelist, never from user input.
    assert set(changes) <= UPDATABLE
    assignments = ", ".join(col + " = %s" for col in changes)
    try:
        with pool.connection() as conn:
            row = conn.execute(
                "UPDATE exercises SET " + assignments + ", updated_at = now() "
                "WHERE id = %s RETURNING " + COLUMNS,
                list(changes.values()) + [exercise_id],
            ).fetchone()
    except UniqueViolation:
        raise ApiError(409, "duplicate_name", "An active exercise with that name already exists")
    if row is None:
        raise ApiError(404, "not_found", "Exercise not found")
    return row


@router.delete("/{exercise_id}", status_code=204)
def archive_exercise(exercise_id: UUID):
    # Soft delete: logged sets reference exercises, so the row must stay.
    # Idempotent: archiving an already-archived or unknown id is still a 204.
    with pool.connection() as conn:
        conn.execute(
            "UPDATE exercises SET archived = true, updated_at = now() "
            "WHERE id = %s AND NOT archived",
            (exercise_id,),
        )
    return Response(status_code=204)
