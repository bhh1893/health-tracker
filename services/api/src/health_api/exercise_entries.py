"""Exercise Entries and the Sessions derived from them (ADR 0002, ADR 0006, ADR 0012).

An Exercise Entry is one Set, flat, unlike the Meal aggregate: each is written on its own.
A Session has no table and no write path. It is all of one Exercise's Sets on one Day, and
both it and a Set's number are worked out on every read, so they can never go stale.
"""

from datetime import date
from typing import Annotated, Any
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import UUID7, BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from health_api.catalogs import problems
from health_api.db import DbSession, violated_constraint
from health_api.entries import (
    DEFAULT_PAGE_SIZE,
    MAX_AMOUNT,
    MAX_PAGE_SIZE,
    Day,
    Occurrence,
    PutOccurrence,
    encode_cursor,
    invalid_field,
    range_filters,
)
from health_api.identity import CurrentUser
from health_api.problems import CatalogRef

# The most a Postgres integer holds. Above it the insert would fail as a 500, not a 422.
MAX_REPS = 2**31 - 1
# ADR 0013: the Session history sheet and the Last N stepper both start at 5.
DEFAULT_SESSIONS = 5

# Same-owner links are composite FKs (ADR 0002), so "no such Exercise" and "someone else's
# Exercise" are one error, and neither reveals the other.
EXERCISE_CONSTRAINT = "exercise_entries_exercise_id_user_id_fkey"


class PutExerciseEntry(PutOccurrence):
    exercise_id: UUID
    # strict: the contract says integer and number, so "5" is refused, not quietly converted.
    reps: int = Field(gt=0, le=MAX_REPS, strict=True)
    # Leaving it out means bodyweight: a PUT replaces the whole Entry.
    weight_lb: float | None = Field(
        default=None, gt=0, le=MAX_AMOUNT, allow_inf_nan=False, strict=True
    )


class ExerciseEntry(Occurrence):
    exercise: CatalogRef
    reps: int
    weight_lb: float | None


class ExerciseEntryPage(BaseModel):
    items: list[ExerciseEntry]
    next_cursor: str | None


class SessionSet(BaseModel):
    number: int
    reps: int
    weight_lb: float | None


class ExerciseSession(BaseModel):
    day: date
    sets: list[SessionSet]


def select_entries(
    session: Session, user: UUID, where: str, limit: int = 1, **params: Any
) -> list[ExerciseEntry]:
    """The one read path, newest first, so every response carries the same derived fields.

    The inner query picks the page; `number` is computed outside it, so only those rows pay
    for it. It counts the Session's Sets in the table, not in the page, so a filter or a page
    boundary cannot change a Set's number.
    """
    rows = session.execute(
        text(
            f"""
            SELECT e.id, e.reps, e.weight_lb, e.occurred_at, e.occurred_tz, e.day,
                   (
                       SELECT count(*) FROM exercise_entries n
                       WHERE n.user_id = e.user_id AND n.exercise_id = e.exercise_id
                         AND n.day = e.day
                         AND (n.occurred_at, n.id) <= (e.occurred_at, e.id)
                   ) AS number,
                   x.id AS exercise_id, x.name AS exercise_name,
                   x.archived_at IS NOT NULL AS exercise_archived
            FROM (
                SELECT * FROM exercise_entries e
                WHERE e.user_id = :user AND {where}
                ORDER BY e.day DESC, e.occurred_at DESC, e.id DESC
                LIMIT :limit
            ) e
            JOIN exercises x ON x.id = e.exercise_id
            ORDER BY e.day DESC, e.occurred_at DESC, e.id DESC
            """
        ),
        {"user": user, "limit": limit, **params},
    ).all()
    return [
        ExerciseEntry(
            id=row.id,
            exercise=CatalogRef(
                id=row.exercise_id, name=row.exercise_name, archived=row.exercise_archived
            ),
            reps=row.reps,
            weight_lb=row.weight_lb,
            # The moment is stored without its offset. occurred_tz puts it back (ADR 0006).
            occurred_at=row.occurred_at.astimezone(ZoneInfo(row.occurred_tz)),
            occurred_tz=row.occurred_tz,
            day=row.day,
            number=row.number,
        )
        for row in rows
    ]


def load_entry(session: Session, user: UUID, entry_id: UUID) -> ExerciseEntry:
    entries = select_entries(session, user, "e.id = :id", id=entry_id)
    if not entries:
        raise HTTPException(404, "Exercise Entry not found.")
    return entries[0]


def select_sessions(
    session: Session, user: UUID, exercise_id: UUID, limit: int
) -> list[ExerciseSession]:
    """The last `limit` Sessions, newest first, each with its Sets in order.

    Two steps, as ADR 0012 planned: `recent` walks the Exercise index backwards and stops
    after `limit` distinct Days, then only those Days' Sets are read. Every Session arrives
    whole, so row_number() can number its Sets; the feed's pages cannot rely on that.
    """
    rows = session.execute(
        text(
            """
            WITH recent AS (
                SELECT DISTINCT day FROM exercise_entries
                WHERE user_id = :user AND exercise_id = :exercise
                ORDER BY day DESC
                LIMIT :limit
            )
            SELECT e.day, e.reps, e.weight_lb,
                   row_number() OVER (PARTITION BY e.day ORDER BY e.occurred_at, e.id) AS number
            FROM exercise_entries e
            JOIN recent USING (day)
            WHERE e.user_id = :user AND e.exercise_id = :exercise
            ORDER BY e.day DESC, number
            """
        ),
        {"user": user, "exercise": exercise_id, "limit": limit},
    ).all()
    sessions: dict[date, list[SessionSet]] = {}
    for row in rows:
        sessions.setdefault(row.day, []).append(
            SessionSet(number=row.number, reps=row.reps, weight_lb=row.weight_lb)
        )
    return [ExerciseSession(day=day, sets=sets) for day, sets in sessions.items()]


def exercise_entries_router() -> APIRouter:
    router = APIRouter(prefix="/api/v1", tags=["exercise-entries"])

    @router.get(
        "/exercise-entries",
        operation_id="list_exercise_entries",
        response_model=ExerciseEntryPage,
        description="List Exercise Entries newest first, by Day range and Exercise, paged.",
    )
    def list_exercise_entries(
        user: CurrentUser,
        session: DbSession,
        from_day: Annotated[Day | None, Query(alias="from")] = None,
        to_day: Annotated[Day | None, Query(alias="to")] = None,
        exercise_id: UUID | None = None,
        cursor: str | None = None,
        limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
    ) -> ExerciseEntryPage:
        where, params = range_filters("e", from_day, to_day, cursor)
        if exercise_id is not None:
            where.append("e.exercise_id = :exercise_id")
            params["exercise_id"] = exercise_id

        # One extra row answers "is there a next page?" without a count.
        entries = select_entries(session, user, " AND ".join(where), limit + 1, **params)
        page = entries[:limit]
        return ExerciseEntryPage(
            items=page, next_cursor=encode_cursor(page[-1]) if len(entries) > limit else None
        )

    @router.get(
        "/exercise-entries/{entry_id}",
        operation_id="get_exercise_entry",
        response_model=ExerciseEntry,
        description="Read one Exercise Entry.",
        responses=problems(404),
    )
    def get_exercise_entry(entry_id: UUID, user: CurrentUser, session: DbSession) -> ExerciseEntry:
        return load_entry(session, user, entry_id)

    @router.put(
        "/exercise-entries/{entry_id}",
        operation_id="put_exercise_entry",
        response_model=ExerciseEntry,
        description="Create an Exercise Entry at a client-generated UUIDv7, or replace it.",
        responses={201: {"model": ExerciseEntry, "description": "Created."}, **problems(404)},
    )
    def put_exercise_entry(
        entry_id: UUID7,
        body: PutExerciseEntry,
        response: Response,
        user: CurrentUser,
        session: DbSession,
    ) -> ExerciseEntry:
        try:
            # The WHERE is the ownership check: on someone else's id it writes nothing and
            # returns no row. old is Postgres 18: the row before this write, absent on
            # insert, so of two racing first attempts exactly one is told it created the Entry.
            written = session.execute(
                text(
                    """
                    INSERT INTO exercise_entries AS e
                        (id, user_id, exercise_id, reps, weight_lb,
                         occurred_at, occurred_tz, day)
                    VALUES (:id, :user, :exercise, :reps, :weight_lb,
                            :occurred_at, :occurred_tz, :day)
                    ON CONFLICT (id) DO UPDATE SET
                        exercise_id = EXCLUDED.exercise_id,
                        reps = EXCLUDED.reps,
                        weight_lb = EXCLUDED.weight_lb,
                        occurred_at = EXCLUDED.occurred_at,
                        occurred_tz = EXCLUDED.occurred_tz,
                        day = EXCLUDED.day,
                        updated_at = now()
                    WHERE e.user_id = EXCLUDED.user_id
                    RETURNING old.id IS NULL AS created
                    """
                ),
                {
                    "id": entry_id,
                    "user": user,
                    "exercise": body.exercise_id,
                    "reps": body.reps,
                    "weight_lb": body.weight_lb,
                    "occurred_at": body.occurred_at,
                    "occurred_tz": body.occurred_tz,
                    "day": body.day,
                },
            ).first()
        except IntegrityError as error:
            session.rollback()
            if violated_constraint(error) != EXERCISE_CONSTRAINT:
                raise
            raise invalid_field(("body", "exercise_id"), "This Exercise does not exist.") from None
        if written is None:
            raise HTTPException(404, "Exercise Entry not found.")
        # Read before commit, so the response is what this transaction wrote.
        entry = load_entry(session, user, entry_id)
        session.commit()
        if written.created:
            response.status_code = 201
        return entry

    @router.delete(
        "/exercise-entries/{entry_id}",
        operation_id="delete_exercise_entry",
        status_code=204,
        description="Delete an Exercise Entry.",
    )
    def delete_exercise_entry(entry_id: UUID, user: CurrentUser, session: DbSession) -> None:
        session.execute(
            text("DELETE FROM exercise_entries WHERE id = :id AND user_id = :user"),
            {"id": entry_id, "user": user},
        )
        session.commit()

    @router.get(
        "/exercises/{exercise_id}/sessions",
        operation_id="get_exercise_sessions",
        response_model=list[ExerciseSession],
        description="List an Exercise's last N Sessions, newest first, with numbered Sets.",
        responses=problems(404),
    )
    def get_exercise_sessions(
        exercise_id: UUID,
        user: CurrentUser,
        session: DbSession,
        limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_SESSIONS,
    ) -> list[ExerciseSession]:
        # An Exercise never used has no Sessions, which is an empty list, not a 404.
        mine = session.execute(
            text("SELECT 1 FROM exercises WHERE id = :id AND user_id = :user"),
            {"id": exercise_id, "user": user},
        ).first()
        if mine is None:
            raise HTTPException(404, "Exercise not found.")
        return select_sessions(session, user, exercise_id, limit)

    return router
