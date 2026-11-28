"""Meal Days: History's Recent Days on Meals, whole Days paged by Day (ADR 0033).

GET /meals pages by Meal, so one Day can straddle two pages, and a filter there would hide the
rest of a matching Day. This route pages by Day instead, and a Day always comes whole.
"""

from base64 import urlsafe_b64decode, urlsafe_b64encode
from datetime import date
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from health_api.catalogs import (
    MAX_NAME_LENGTH,
    NO_NUL,
    RestaurantCategory,
    escape_like,
    normalize_name,
)
from health_api.db import DbSession
from health_api.entries import Day, invalid_field
from health_api.identity import CurrentUser
from health_api.meals import FoodsMeal, Meal, RestaurantMeal, select_meals

# limit counts Days, not Meals. A busy Day has about six Meals, so the maximum page is near
# the 200 Meals GET /meals allows.
DEFAULT_DAY_PAGE_SIZE = 20
MAX_DAY_PAGE_SIZE = 100

# Days that have a Meal with a Food or Restaurant whose name contains the text, ignoring case.
# Any of a Meal's Restaurants counts, not only the first (ADR 0034). Each subquery starts from
# the name, so Postgres can find the matching names through the `*_name_trgm` GIN indexes on
# lower(name) (ADR 0012), then the Meals that use them.
# Archived Foods and Restaurants match too: this is about what was eaten, not the Catalog.
NAME_FILTER = r"""
    (
        m.id IN (
            SELECT e.meal_id FROM food_entries e
            JOIN foods f ON f.id = e.food_id
            WHERE e.user_id = :user AND f.user_id = :user
              AND lower(f.name) LIKE lower(:contains) ESCAPE '\'
        )
        OR m.id IN (
            SELECT mr.meal_id FROM meal_restaurants mr
            JOIN restaurants r ON r.id = mr.restaurant_id
            WHERE mr.user_id = :user AND r.user_id = :user
              AND lower(r.name) LIKE lower(:contains) ESCAPE '\'
        )
    )
"""


# Days that have a Restaurant Meal with a Restaurant of this Category (ADR 0041). Starts from the
# User's Restaurants, a few hundred rows, then finds their Meals through the same
# (user_id, restaurant_id) index the name filter uses. No index on category: it would only
# narrow a list that is already that small.
CATEGORY_FILTER = """
    m.id IN (
        SELECT mr.meal_id FROM meal_restaurants mr
        JOIN restaurants r ON r.id = mr.restaurant_id
        WHERE mr.user_id = :user AND r.user_id = :user AND r.category = :category
    )
"""


class MealDay(BaseModel):
    day: date
    # Newest first, each in the shape GET /meals/{id} returns.
    meals: list[Meal]


class MealDayPage(BaseModel):
    items: list[MealDay]
    next_cursor: str | None


def encode_day_cursor(day: date) -> str:
    # Opaque like every cursor here (ADR 0006): clients pass it back, never read it.
    return urlsafe_b64encode(day.isoformat().encode()).decode()


def decode_day_cursor(cursor: str) -> date:
    try:
        return date.fromisoformat(urlsafe_b64decode(cursor).decode())
    except ValueError:
        raise invalid_field(("query", "cursor"), "Not a cursor from this API.") from None


def select_days(
    session: Session, user: UUID, where: list[str], limit: int, **params: Any
) -> list[date]:
    """The page's Days, newest first: the Days with a Meal that `where` keeps.

    A Day is a natural key here: one User has at most one of each date, so the Day alone
    orders the list with no tie to break, and it is the whole cursor.
    """
    rows = session.execute(
        text(
            f"""
            SELECT DISTINCT m.day FROM meals m
            WHERE m.user_id = :user AND {" AND ".join(where)}
            ORDER BY m.day DESC
            LIMIT :limit
            """
        ),
        {"user": user, "limit": limit, **params},
    )
    return list(rows.scalars())


def meal_days_router() -> APIRouter:
    router = APIRouter(prefix="/api/v1/meal-days", tags=["meals"])

    @router.get(
        "",
        operation_id="list_meal_days",
        response_model=MealDayPage,
        description=(
            "List Days with their Meals newest first, one page of whole Days at a time, "
            "optionally only Days with a Food or Restaurant whose name contains q, "
            "or with a Restaurant of a Category. A Day must match both when both are sent."
        ),
    )
    def list_meal_days(
        user: CurrentUser,
        session: DbSession,
        from_day: Annotated[Day | None, Query(alias="from")] = None,
        to_day: Annotated[Day | None, Query(alias="to")] = None,
        q: Annotated[str, Query(max_length=MAX_NAME_LENGTH, pattern=NO_NUL)] = "",
        category: RestaurantCategory | None = None,
        cursor: str | None = None,
        limit: Annotated[int, Query(ge=1, le=MAX_DAY_PAGE_SIZE)] = DEFAULT_DAY_PAGE_SIZE,
    ) -> MealDayPage:
        where = ["true"]
        params: dict[str, Any] = {}
        if from_day is not None:
            where.append("m.day >= :from_day")
            params["from_day"] = from_day
        if to_day is not None:
            where.append("m.day <= :to_day")
            params["to_day"] = to_day
        if cursor is not None:
            # Newest first, so the next page is the Days before the last one seen.
            where.append("m.day < :cursor_day")
            params["cursor_day"] = decode_day_cursor(cursor)
        # Names are stored with their spaces collapsed, so the text is read the same way.
        query = normalize_name(q)
        if query:
            where.append(NAME_FILTER)
            params["contains"] = f"%{escape_like(query)}%"
        if category is not None:
            where.append(CATEGORY_FILTER)
            params["category"] = category

        # One extra Day answers "is there a next page?" without a count.
        days = select_days(session, user, where, limit + 1, **params)
        page = days[:limit]
        # Every Meal of those Days, not only the ones that matched q: a kept Day shows whole.
        # The Days bound the rows, so no LIMIT is needed.
        meals = select_meals(session, user, "m.day = ANY(:days)", limit=None, days=page)
        by_day: dict[date, list[FoodsMeal | RestaurantMeal]] = {day: [] for day in page}
        for meal in meals:
            by_day[meal.day].append(meal)
        return MealDayPage(
            # A Day whose last Meal was deleted between the two reads is left out, not empty.
            items=[MealDay(day=day, meals=by_day[day]) for day in page if by_day[day]],
            next_cursor=encode_day_cursor(page[-1]) if len(days) > limit else None,
        )

    return router
