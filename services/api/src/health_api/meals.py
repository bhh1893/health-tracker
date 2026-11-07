"""Meals: one aggregate, read and written whole (ADR 0002, ADR 0006, ADR 0012).

Food Entries have no endpoint of their own. Every write goes through PUT /meals/{id} and
replaces the whole Meal in one transaction, which is what lets the API keep the rule the
database cannot: a Foods Meal has at least one Food Entry.
"""

import re
from base64 import urlsafe_b64decode, urlsafe_b64encode
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Any, Literal, Self
from uuid import UUID
from zoneinfo import ZoneInfo, available_timezones

from fastapi import APIRouter, HTTPException, Query, Response
from fastapi.exceptions import RequestValidationError
from pydantic import (
    UUID7,
    AfterValidator,
    AwareDatetime,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    model_validator,
)
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from health_api.catalogs import CatalogName, problems
from health_api.db import DbSession
from health_api.identity import CurrentUser
from health_api.problems import KIND_IMMUTABLE, LAST_FOOD_ENTRY, CatalogRef, ProblemError

MAX_FUTURE = timedelta(minutes=5)
# Far above any real Meal. Bounds the rows one request can write.
MAX_FOOD_ENTRIES = 100
DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200

RFC_3339 = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})")
TIMEZONES = available_timezones()

# Which field a failed foreign key means. Same-owner links are composite FKs (ADR 0002), so
# "no such item" and "someone else's item" are one error, and neither reveals the other.
REFERENCE_CONSTRAINTS = {
    "food_entries_food_id_user_id_fkey": ("food_entries", "A Food here does not exist."),
    "meals_restaurant_id_user_id_fkey": ("restaurant_id", "This Restaurant does not exist."),
}

Unit = Literal["g", "count"]


def rfc_3339(value: object) -> object:
    # Pydantic alone also takes numbers and numeric strings, as Unix timestamps.
    if not isinstance(value, str) or not RFC_3339.fullmatch(value):
        raise ValueError("Must be RFC 3339 with an offset.")
    return value


def not_in_the_future(value: datetime) -> datetime:
    if value > datetime.now(UTC) + MAX_FUTURE:
        raise ValueError("Must be at most 5 minutes in the future.")
    return value


def known_timezone(value: str) -> str:
    if value not in TIMEZONES:
        raise ValueError("Must be an IANA timezone name.")
    return value


def blank_to_none(value: object) -> object:
    # An empty form field sends "". One stored meaning for "no label": NULL.
    return None if isinstance(value, str) and not value.strip() else value


OccurredAt = Annotated[AwareDatetime, BeforeValidator(rfc_3339), AfterValidator(not_in_the_future)]
OccurredTz = Annotated[str, AfterValidator(known_timezone)]


class PutFoodEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    food_id: UUID
    quantity: float = Field(gt=0, allow_inf_nan=False)
    unit: Unit


class PutMealFields(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Same rules as a Catalog name. Leaving it out clears it: a PUT replaces the whole Meal.
    label: Annotated[CatalogName | None, BeforeValidator(blank_to_none)] = None
    occurred_at: OccurredAt
    occurred_tz: OccurredTz

    @property
    def day(self) -> date:
        return self.occurred_at.astimezone(ZoneInfo(self.occurred_tz)).date()

    @model_validator(mode="after")
    def day_exists(self) -> Self:
        # ADR 0006 sets no past bound, but year 1 at a +14:00 offset has no UTC equivalent.
        try:
            _ = self.day
        except OverflowError:
            raise ValueError("occurred_at is out of range.") from None
        return self


class PutFoodsMeal(PutMealFields):
    kind: Literal["foods"]
    # No min_length: an empty list is 409 on a saved Meal and 422 on a new one, and only the
    # database knows which. See write_meal.
    food_entries: list[PutFoodEntry] = Field(max_length=MAX_FOOD_ENTRIES)


class PutRestaurantMeal(PutMealFields):
    kind: Literal["restaurant"]
    restaurant_id: UUID


PutMeal = Annotated[PutFoodsMeal | PutRestaurantMeal, Field(discriminator="kind")]


class FoodEntry(BaseModel):
    food: CatalogRef
    quantity: float
    unit: Unit


class MealFields(BaseModel):
    id: UUID
    label: str | None
    occurred_at: datetime
    occurred_tz: str
    day: date
    number: int


class FoodsMeal(MealFields):
    kind: Literal["foods"] = "foods"
    food_entries: list[FoodEntry]


class RestaurantMeal(MealFields):
    kind: Literal["restaurant"] = "restaurant"
    restaurant: CatalogRef


Meal = Annotated[FoodsMeal | RestaurantMeal, Field(discriminator="kind")]


class MealPage(BaseModel):
    items: list[Meal]
    next_cursor: str | None


def encode_cursor(meal: FoodsMeal | RestaurantMeal) -> str:
    position = f"{meal.day}|{meal.occurred_at.isoformat()}|{meal.id}"
    return urlsafe_b64encode(position.encode()).decode()


def decode_cursor(cursor: str) -> dict[str, Any]:
    try:
        day, occurred_at, meal_id = urlsafe_b64decode(cursor).decode().split("|")
        return {
            "cursor_day": date.fromisoformat(day),
            "cursor_at": datetime.fromisoformat(occurred_at),
            "cursor_id": UUID(meal_id),
        }
    except ValueError:
        raise invalid_field(("query", "cursor"), "Not a cursor from this API.") from None


def invalid_field(location: tuple[str, ...], message: str) -> RequestValidationError:
    """A 422 found after parsing, in the same shape as one found by the request models."""
    return RequestValidationError([{"type": "value_error", "loc": location, "msg": message}])


def load_food_entries(
    session: Session, user: UUID, meal_ids: list[UUID]
) -> dict[UUID, list[FoodEntry]]:
    """All the Meals' Food Entries in one query, not one query per Meal."""
    rows = session.execute(
        text(
            """
            SELECT e.meal_id, e.quantity, e.unit, f.id, f.name,
                   f.archived_at IS NOT NULL AS archived
            FROM food_entries e
            JOIN foods f ON f.id = e.food_id
            WHERE e.user_id = :user AND e.meal_id = ANY(:meal_ids)
            ORDER BY e.id
            """
        ),
        {"user": user, "meal_ids": meal_ids},
    ).mappings()
    entries: dict[UUID, list[FoodEntry]] = {meal_id: [] for meal_id in meal_ids}
    for row in rows:
        food = CatalogRef(id=row["id"], name=row["name"], archived=row["archived"])
        entries[row["meal_id"]].append(
            FoodEntry(food=food, quantity=row["quantity"], unit=row["unit"])
        )
    return entries


def select_meals(
    session: Session, user: UUID, where: str, limit: int = 1, **params: Any
) -> list[FoodsMeal | RestaurantMeal]:
    """The one read path, newest first, so every response carries the same derived fields.

    The inner query picks the page; `number` is computed outside it, so only those rows pay
    for it. It counts the Day's Meals in the table, not in the page, so a filter or a page
    boundary cannot change a Meal's number.
    """
    rows = session.execute(
        text(
            f"""
            SELECT m.id, m.kind, m.label, m.occurred_at, m.occurred_tz, m.day,
                   (
                       SELECT count(*) FROM meals n
                       WHERE n.user_id = m.user_id AND n.day = m.day
                         AND (n.occurred_at, n.id) <= (m.occurred_at, m.id)
                   ) AS number,
                   r.id AS restaurant_id, r.name AS restaurant_name,
                   r.archived_at IS NOT NULL AS restaurant_archived
            FROM (
                SELECT * FROM meals m
                WHERE m.user_id = :user AND {where}
                ORDER BY m.day DESC, m.occurred_at DESC, m.id DESC
                LIMIT :limit
            ) m
            LEFT JOIN restaurants r ON r.id = m.restaurant_id
            ORDER BY m.day DESC, m.occurred_at DESC, m.id DESC
            """
        ),
        {"user": user, "limit": limit, **params},
    ).all()
    food_entries = load_food_entries(session, user, [row.id for row in rows if row.kind == "foods"])

    meals: list[FoodsMeal | RestaurantMeal] = []
    for row in rows:
        fields: dict[str, Any] = {
            "id": row.id,
            "label": row.label,
            # The moment is stored without its offset. occurred_tz puts it back (ADR 0006).
            "occurred_at": row.occurred_at.astimezone(ZoneInfo(row.occurred_tz)),
            "occurred_tz": row.occurred_tz,
            "day": row.day,
            "number": row.number,
        }
        if row.kind == "foods":
            meals.append(FoodsMeal(**fields, food_entries=food_entries[row.id]))
        else:
            restaurant = CatalogRef(
                id=row.restaurant_id, name=row.restaurant_name, archived=row.restaurant_archived
            )
            meals.append(RestaurantMeal(**fields, restaurant=restaurant))
    return meals


def load_meal(session: Session, user: UUID, meal_id: UUID) -> FoodsMeal | RestaurantMeal:
    meals = select_meals(session, user, "m.id = :id", id=meal_id)
    if not meals:
        raise HTTPException(404, "Meal not found.")
    return meals[0]


def write_meal(
    session: Session, user: UUID, meal_id: UUID, body: PutFoodsMeal | PutRestaurantMeal
) -> bool:
    """Replaces the Meal and its Food Entries. True if this created it. The caller commits.

    The upsert goes first because it also takes the row lock: a second PUT to this Meal waits
    here, so two replaces cannot interleave their Food Entries.
    """
    written = session.execute(
        text(
            """
            INSERT INTO meals AS m
                (id, user_id, kind, restaurant_id, label, occurred_at, occurred_tz, day)
            VALUES (:id, :user, :kind, :restaurant, :label, :occurred_at, :occurred_tz, :day)
            ON CONFLICT (id) DO UPDATE SET
                restaurant_id = EXCLUDED.restaurant_id,
                label = EXCLUDED.label,
                occurred_at = EXCLUDED.occurred_at,
                occurred_tz = EXCLUDED.occurred_tz,
                day = EXCLUDED.day,
                updated_at = now()
            WHERE m.user_id = EXCLUDED.user_id AND m.kind = EXCLUDED.kind
            RETURNING old.id IS NULL AS created
            """
        ),
        {
            "id": meal_id,
            "user": user,
            "kind": body.kind,
            "restaurant": body.restaurant_id if isinstance(body, PutRestaurantMeal) else None,
            "label": body.label,
            "occurred_at": body.occurred_at,
            "occurred_tz": body.occurred_tz,
            "day": body.day,
        },
    ).first()

    if written is None:
        # The WHERE refused: someone else's id, or this user's Meal of the other kind.
        mine = session.execute(
            text("SELECT 1 FROM meals WHERE id = :id AND user_id = :user"),
            {"id": meal_id, "user": user},
        ).first()
        if mine is None:
            raise HTTPException(404, "Meal not found.")
        raise ProblemError(
            409,
            type=KIND_IMMUTABLE,
            detail="A Meal cannot change between foods and restaurant.",
        )

    if isinstance(body, PutFoodsMeal):
        if not body.food_entries:
            # Undoes the upsert above: nothing of a refused PUT may survive.
            session.rollback()
            if written.created:
                raise invalid_field(
                    ("body", "food_entries"), "A foods Meal needs at least one Food Entry."
                )
            raise ProblemError(
                409,
                type=LAST_FOOD_ENTRY,
                detail="A Meal keeps at least one Food Entry. Delete the Meal instead.",
            )
        session.execute(
            text("DELETE FROM food_entries WHERE meal_id = :meal AND user_id = :user"),
            {"meal": meal_id, "user": user},
        )
        session.execute(
            text(
                """
                INSERT INTO food_entries (user_id, meal_id, food_id, quantity, unit)
                VALUES (:user, :meal, :food, :quantity, :unit)
                """
            ),
            [
                {
                    "user": user,
                    "meal": meal_id,
                    "food": entry.food_id,
                    "quantity": entry.quantity,
                    "unit": entry.unit,
                }
                for entry in body.food_entries
            ],
        )
    return written.created


def meals_router() -> APIRouter:
    router = APIRouter(prefix="/api/v1/meals", tags=["meals"])

    @router.get(
        "",
        operation_id="list_meals",
        response_model=MealPage,
        description="List Meals newest first, by Day range and Food, one page at a time.",
    )
    def list_meals(
        user: CurrentUser,
        session: DbSession,
        from_day: Annotated[date | None, Query(alias="from")] = None,
        to_day: Annotated[date | None, Query(alias="to")] = None,
        food_id: UUID | None = None,
        cursor: str | None = None,
        limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
    ) -> MealPage:
        where = ["true"]
        params: dict[str, Any] = {}
        if from_day is not None:
            where.append("m.day >= :from_day")
            params["from_day"] = from_day
        if to_day is not None:
            where.append("m.day <= :to_day")
            params["to_day"] = to_day
        if food_id is not None:
            where.append(
                """
                m.id IN (
                    SELECT e.meal_id FROM food_entries e
                    WHERE e.user_id = :user AND e.food_id = :food_id
                )
                """
            )
            params["food_id"] = food_id
        if cursor is not None:
            where.append("(m.day, m.occurred_at, m.id) < (:cursor_day, :cursor_at, :cursor_id)")
            params.update(decode_cursor(cursor))

        # One extra row answers "is there a next page?" without a count.
        meals = select_meals(session, user, " AND ".join(where), limit + 1, **params)
        page = meals[:limit]
        return MealPage(
            items=page, next_cursor=encode_cursor(page[-1]) if len(meals) > limit else None
        )

    @router.get(
        "/{meal_id}",
        operation_id="get_meal",
        response_model=Meal,
        description="Read one Meal with its Food Entries or Restaurant.",
        responses=problems(404),
    )
    def get_meal(
        meal_id: UUID, user: CurrentUser, session: DbSession
    ) -> FoodsMeal | RestaurantMeal:
        return load_meal(session, user, meal_id)

    @router.put(
        "/{meal_id}",
        operation_id="put_meal",
        response_model=Meal,
        description="Create a Meal at a client-generated UUIDv7, or replace the whole Meal.",
        responses={201: {"model": Meal, "description": "Created."}, **problems(404, 409)},
    )
    def put_meal(
        meal_id: UUID7,
        body: PutMeal,
        response: Response,
        user: CurrentUser,
        session: DbSession,
    ) -> FoodsMeal | RestaurantMeal:
        try:
            created = write_meal(session, user, meal_id, body)
        except IntegrityError as error:
            session.rollback()
            constraint = getattr(getattr(error.orig, "diag", None), "constraint_name", None)
            if constraint not in REFERENCE_CONSTRAINTS:
                raise
            field, message = REFERENCE_CONSTRAINTS[constraint]
            raise invalid_field(("body", field), message) from None
        # Read before commit, so the response is what this transaction wrote.
        meal = load_meal(session, user, meal_id)
        session.commit()
        if created:
            response.status_code = 201
        return meal

    @router.delete(
        "/{meal_id}",
        operation_id="delete_meal",
        status_code=204,
        description="Delete a Meal and its Food Entries.",
    )
    def delete_meal(meal_id: UUID, user: CurrentUser, session: DbSession) -> None:
        # Food Entries go with it, by the foreign keys' ON DELETE CASCADE.
        session.execute(
            text("DELETE FROM meals WHERE id = :id AND user_id = :user"),
            {"id": meal_id, "user": user},
        )
        session.commit()

    return router
