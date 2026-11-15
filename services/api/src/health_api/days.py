"""Day Totals: calories and macros per Day, computed on every read (ADR 0023).

Nothing here is stored. A total is summed from the Day's Food Entries using each Food's
current Nutrition, so correcting a Food corrects every past Day. The Restaurant Day and
Incomplete Day rules live in this one query, so no client has to repeat them.
"""

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from health_api.db import DbSession
from health_api.entries import Day, invalid_field
from health_api.identity import CurrentUser

# A leap year, both ends included. One row per Day, so this also bounds the response.
MAX_RANGE_DAYS = 366

# The SQL below reads a Food Entry as `e` and its Food as `f`.
#
# What an Entry weighs. A count goes through the Food's Piece Weight, and is NULL without one.
ENTRY_GRAMS = "CASE e.unit WHEN 'g' THEN e.quantity ELSE e.quantity * f.piece_g END"
# An Entry a total has to leave out: its Food has no Nutrition, or it is a count of a Food
# with no Piece Weight.
ENTRY_UNCOUNTED = "(f.basis_g IS NULL OR (e.unit = 'count' AND f.piece_g IS NULL))"


def entry_amount(column: str) -> str:
    """One Entry's share of a Nutrition value: grams / Basis x value. NULL when uncounted."""
    return f"{ENTRY_GRAMS} / f.basis_g * f.{column}"


class DayTotal(BaseModel):
    day: date
    kcal: float
    # Null on a Restaurant Day: unknown, which is not the same as 0 g (ADR 0023).
    protein_g: float | None
    carbs_g: float | None
    fat_g: float | None
    restaurant_day: bool
    incomplete: bool


def select_day_totals(session: Session, user: UUID, from_day: date, to_day: date) -> list[DayTotal]:
    """One row per Day in the range that has a Meal, newest first.

    Starts from `meals`, not `food_entries`, so a Day with only a Restaurant Meal still
    appears. sum() skips the NULL of an uncounted Entry, which is how an Incomplete Day still
    totals what is known; coalesce covers the Day where nothing could be counted at all.
    """

    def known(column: str) -> str:
        return f"coalesce(sum({entry_amount(column)}), 0)"

    rows = session.execute(
        text(
            f"""
            SELECT d.day, d.restaurant_day,
                   CASE WHEN d.restaurant_day THEN u.restaurant_day_kcal ELSE d.kcal END AS kcal,
                   CASE WHEN NOT d.restaurant_day THEN d.protein_g END AS protein_g,
                   CASE WHEN NOT d.restaurant_day THEN d.carbs_g END AS carbs_g,
                   CASE WHEN NOT d.restaurant_day THEN d.fat_g END AS fat_g,
                   NOT d.restaurant_day AND d.uncounted > 0 AS incomplete
            FROM (
                SELECT m.day,
                       bool_or(m.kind = 'restaurant') AS restaurant_day,
                       {known("kcal")} AS kcal,
                       {known("protein_g")} AS protein_g,
                       {known("carbs_g")} AS carbs_g,
                       {known("fat_g")} AS fat_g,
                       count(*) FILTER (WHERE e.id IS NOT NULL AND {ENTRY_UNCOUNTED})
                           AS uncounted
                FROM meals m
                LEFT JOIN food_entries e ON e.meal_id = m.id
                LEFT JOIN foods f ON f.id = e.food_id
                WHERE m.user_id = :user AND m.day >= :from_day AND m.day <= :to_day
                GROUP BY m.day
            ) d
            JOIN users u ON u.id = :user
            ORDER BY d.day DESC
            """
        ),
        {"user": user, "from_day": from_day, "to_day": to_day},
    ).mappings()
    return [DayTotal.model_validate(dict(row)) for row in rows]


def days_router() -> APIRouter:
    router = APIRouter(prefix="/api/v1/days", tags=["days"])

    @router.get(
        "",
        operation_id="list_days",
        response_model=list[DayTotal],
        description="List calories and macros per Day with a Meal, newest first, for a Day range.",
    )
    def list_days(
        user: CurrentUser,
        session: DbSession,
        from_day: Annotated[Day, Query(alias="from")],
        to_day: Annotated[Day, Query(alias="to")],
    ) -> list[DayTotal]:
        if to_day < from_day:
            raise invalid_field(("query", "to"), "Must not be before from.")
        if (to_day - from_day).days > MAX_RANGE_DAYS:
            raise invalid_field(
                ("query", "to"), f"Must be at most {MAX_RANGE_DAYS} days after from."
            )
        return select_day_totals(session, user, from_day, to_day)

    return router
