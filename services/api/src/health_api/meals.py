"""Meals: one aggregate, read and written whole (ADR 0002, ADR 0006, ADR 0012).

Food Entries and a Meal's Restaurants have no endpoint of their own. Every write goes through
PUT /meals/{id} and replaces the whole Meal in one transaction, which is what lets the API keep
the rules the database cannot: a foods Meal has at least one Food Entry, and a Restaurant Meal
at least one Restaurant (ADR 0034).
"""

from decimal import Decimal
from typing import Annotated, Any, Literal, Self
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query, Response
from fastapi.exceptions import RequestValidationError
from pydantic import UUID7, BaseModel, BeforeValidator, ConfigDict, Field, model_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from health_api.catalogs import CatalogName, problems
from health_api.days import ENTRY_UNCOUNTED, entry_amount
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
from health_api.problems import (
    KIND_IMMUTABLE,
    LAST_FOOD_ENTRY,
    SEVERAL_RESTAURANTS,
    CatalogRef,
    ProblemError,
)

# Far above any real Meal. Bounds the rows one request can write.
MAX_FOOD_ENTRIES = 100
# Ten stops in one sitting is already a lot; each kind's cap fits its own use (ADR 0034).
MAX_RESTAURANTS = 10

# The foreign keys that refuse a missing Food or Restaurant. Same-owner links are composite FKs
# (ADR 0002), so "no such item" and "someone else's item" are one error, and neither reveals
# the other.
FOOD_REFERENCE = "food_entries_food_id_user_id_fkey"
# Two, while meals.restaurant_id still holds the first Restaurant (ADR 0034).
RESTAURANT_REFERENCES = {
    "meals_restaurant_id_user_id_fkey",
    "meal_restaurants_restaurant_id_user_id_fkey",
}

# Marks a field as on its way out in the contract, without the runtime warning pydantic's own
# `deprecated` adds to every read of it. Removed only in an /api/v2 (ADR 0006).
DEPRECATED: dict[str, Any] = {"deprecated": True}

Unit = Literal["g", "count"]


def blank_to_none(value: object) -> object:
    # An empty form field sends "". One stored meaning for "no label": NULL.
    return None if isinstance(value, str) and not value.strip() else value


class PutFoodEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    food_id: UUID
    # strict: the contract says number, so "1.5" is refused and not quietly converted.
    quantity: float = Field(gt=0, le=MAX_AMOUNT, allow_inf_nan=False, strict=True)
    unit: Unit


class PutMealFields(PutOccurrence):
    # Same rules as a Catalog name. Leaving it out clears it: a PUT replaces the whole Meal.
    label: Annotated[CatalogName | None, BeforeValidator(blank_to_none)] = None


class PutFoodsMeal(PutMealFields):
    kind: Literal["foods"]
    # No min_length: an empty list is 409 on a saved Meal and 422 on a new one, and only the
    # database knows which. See write_meal.
    food_entries: list[PutFoodEntry] = Field(max_length=MAX_FOOD_ENTRIES)


class PutRestaurantMeal(PutMealFields):
    kind: Literal["restaurant"]
    # Read back in the order sent. A Restaurant once per Meal.
    restaurant_ids: (
        Annotated[list[UUID], Field(min_length=1, max_length=MAX_RESTAURANTS)] | None
    ) = None
    # The v1 field from before ADR 0034. Means restaurant_ids: [restaurant_id].
    restaurant_id: UUID | None = Field(default=None, json_schema_extra=DEPRECATED)

    @model_validator(mode="after")
    def restaurants_sent_once(self) -> Self:
        if (self.restaurant_ids is None) == (self.restaurant_id is None):
            raise ValueError("Send restaurant_ids, or the deprecated restaurant_id, not both.")
        if self.restaurant_ids is not None and len(set(self.restaurant_ids)) < len(
            self.restaurant_ids
        ):
            raise ValueError("restaurant_ids lists a Restaurant twice.")
        return self

    @property
    def restaurants(self) -> list[UUID]:
        """The Restaurants in order, whichever field carried them."""
        if self.restaurant_ids is not None:
            return self.restaurant_ids
        assert self.restaurant_id is not None  # restaurants_sent_once guarantees one of them
        return [self.restaurant_id]

    @property
    def restaurants_field(self) -> str:
        """The field an error about the Restaurants belongs to: the one the client sent."""
        return "restaurant_ids" if self.restaurant_ids is not None else "restaurant_id"


PutMeal = Annotated[PutFoodsMeal | PutRestaurantMeal, Field(discriminator="kind")]


class FoodEntry(BaseModel):
    food: CatalogRef
    quantity: float
    unit: Unit


class MealFields(Occurrence):
    label: str | None


class MealTotal(BaseModel):
    """A foods Meal's calories and macros, by the same rules as a Day Total (ADR 0023).

    A Restaurant Meal has none: its Day counts as the User's flat value, and no part of that
    belongs to one Meal.
    """

    kcal: float
    protein_g: float
    carbs_g: float
    fat_g: float
    # Some Food Entry could not be counted, so the values above under-report.
    incomplete: bool


class FoodsMeal(MealFields):
    kind: Literal["foods"] = "foods"
    food_entries: list[FoodEntry]
    total: MealTotal


class RestaurantMeal(MealFields):
    kind: Literal["restaurant"] = "restaurant"
    # In the order they were saved.
    restaurants: list[CatalogRef]
    # The v1 field from before ADR 0034: the first of `restaurants`.
    restaurant: CatalogRef = Field(json_schema_extra=DEPRECATED)


Meal = Annotated[FoodsMeal | RestaurantMeal, Field(discriminator="kind")]


class MealPage(BaseModel):
    items: list[Meal]
    next_cursor: str | None


MACROS = ("kcal", "protein_g", "carbs_g", "fat_g")


def load_food_entries(
    session: Session, user: UUID, meal_ids: list[UUID]
) -> tuple[dict[UUID, list[FoodEntry]], dict[UUID, MealTotal]]:
    """All the Meals' Food Entries and totals in one query, not one query per Meal.

    The database works out each Entry's share with the same SQL as GET /days, so the two
    cannot disagree. Only the adding up happens here.
    """
    shares = ", ".join(f"{entry_amount(column)} AS {column}" for column in MACROS)
    rows = session.execute(
        text(
            f"""
            SELECT e.meal_id, e.quantity, e.unit, f.id, f.name,
                   f.archived_at IS NOT NULL AS archived,
                   {shares}, {ENTRY_UNCOUNTED} AS uncounted
            FROM food_entries e
            JOIN foods f ON f.id = e.food_id
            WHERE e.user_id = :user AND e.meal_id = ANY(:meal_ids)
            ORDER BY e.id
            """
        ),
        {"user": user, "meal_ids": meal_ids},
    ).mappings()
    entries: dict[UUID, list[FoodEntry]] = {meal_id: [] for meal_id in meal_ids}
    sums = {meal_id: dict.fromkeys(MACROS, Decimal(0)) for meal_id in meal_ids}
    incomplete = dict.fromkeys(meal_ids, False)
    for row in rows:
        meal_id = row["meal_id"]
        food = CatalogRef(id=row["id"], name=row["name"], archived=row["archived"])
        entries[meal_id].append(FoodEntry(food=food, quantity=row["quantity"], unit=row["unit"]))
        if row["uncounted"]:
            incomplete[meal_id] = True
            continue
        for column in MACROS:
            sums[meal_id][column] += row[column]
    totals = {
        meal_id: MealTotal(
            **{column: float(value) for column, value in sums[meal_id].items()},
            incomplete=incomplete[meal_id],
        )
        for meal_id in meal_ids
    }
    return entries, totals


def load_restaurants(
    session: Session, user: UUID, meal_ids: list[UUID]
) -> dict[UUID, list[CatalogRef]]:
    """All the Meals' Restaurants in one query, each Meal's in the order they were saved.

    ORDER BY id is that order: a save inserts them in request order, and UUIDv7 ids rise
    within a connection (ADR 0034).
    """
    rows = session.execute(
        text(
            """
            SELECT mr.meal_id, r.id, r.name, r.archived_at IS NOT NULL AS archived
            FROM meal_restaurants mr
            JOIN restaurants r ON r.id = mr.restaurant_id
            WHERE mr.user_id = :user AND mr.meal_id = ANY(:meal_ids)
            ORDER BY mr.id
            """
        ),
        {"user": user, "meal_ids": meal_ids},
    ).mappings()
    restaurants: dict[UUID, list[CatalogRef]] = {meal_id: [] for meal_id in meal_ids}
    for row in rows:
        restaurants[row["meal_id"]].append(
            CatalogRef(id=row["id"], name=row["name"], archived=row["archived"])
        )
    return restaurants


def select_meals(
    session: Session, user: UUID, where: str, limit: int | None = 1, **params: Any
) -> list[FoodsMeal | RestaurantMeal]:
    """The one read path, newest first, so every response carries the same derived fields.

    The inner query picks the page; `number` is computed outside it, so only those rows pay
    for it. It counts the Day's Meals in the table, not in the page, so a filter or a page
    boundary cannot change a Meal's number.

    `limit=None` reads every Meal `where` keeps: Postgres reads LIMIT NULL as no limit. Only
    a caller whose `where` already bounds the rows may pass it.
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
            -- Only for the fallback below. Goes with the column, in the contract step.
            LEFT JOIN restaurants r ON r.id = m.restaurant_id
            ORDER BY m.day DESC, m.occurred_at DESC, m.id DESC
            """
        ),
        {"user": user, "limit": limit, **params},
    ).all()
    food_entries, totals = load_food_entries(
        session, user, [row.id for row in rows if row.kind == "foods"]
    )
    restaurants = load_restaurants(
        session, user, [row.id for row in rows if row.kind == "restaurant"]
    )

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
            meals.append(
                FoodsMeal(**fields, food_entries=food_entries[row.id], total=totals[row.id])
            )
        else:
            # No rows means an api pod from before ADR 0034 saved this Meal mid-rollout: it
            # wrote only the old column. Read that, rather than fail every list holding it.
            stops = restaurants[row.id] or [
                CatalogRef(
                    id=row.restaurant_id,
                    name=row.restaurant_name,
                    archived=row.restaurant_archived,
                )
            ]
            meals.append(RestaurantMeal(**fields, restaurants=stops, restaurant=stops[0]))
    return meals


def load_meal(session: Session, user: UUID, meal_id: UUID) -> FoodsMeal | RestaurantMeal:
    meals = select_meals(session, user, "m.id = :id", id=meal_id)
    if not meals:
        raise HTTPException(404, "Meal not found.")
    return meals[0]


def write_meal(
    session: Session, user: UUID, meal_id: UUID, body: PutFoodsMeal | PutRestaurantMeal
) -> bool:
    """Replaces the Meal and its Food Entries or Restaurants. True if this created it. The
    caller commits.

    The upsert goes first because it also takes the row lock: a second PUT to this Meal waits
    here, so two replaces cannot interleave their rows.
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
            # The first Restaurant, for an api still on the old version mid-rollout (ADR 0034).
            "restaurant": body.restaurants[0] if isinstance(body, PutRestaurantMeal) else None,
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
    else:
        replace_restaurants(session, user, meal_id, body, written.created)
    return written.created


def replace_restaurants(
    session: Session, user: UUID, meal_id: UUID, body: PutRestaurantMeal, created: bool
) -> None:
    """Writes the Meal's Restaurants in request order. Runs under write_meal's row lock."""
    if body.restaurant_id is not None and not created:
        held = session.execute(
            text("SELECT count(*) FROM meal_restaurants WHERE meal_id = :meal AND user_id = :user"),
            {"meal": meal_id, "user": user},
        ).scalar_one()
        if held > 1:
            # A client from before ADR 0034 would drop every Restaurant but one, unseen.
            session.rollback()
            raise ProblemError(
                409,
                type=SEVERAL_RESTAURANTS,
                detail="This Meal has several Restaurants. Send restaurant_ids to change it.",
            )
    session.execute(
        text("DELETE FROM meal_restaurants WHERE meal_id = :meal AND user_id = :user"),
        {"meal": meal_id, "user": user},
    )
    session.execute(
        text(
            """
            INSERT INTO meal_restaurants (user_id, meal_id, restaurant_id)
            VALUES (:user, :meal, :restaurant)
            """
        ),
        [
            {"user": user, "meal": meal_id, "restaurant": restaurant}
            for restaurant in body.restaurants
        ],
    )


def reference_error(
    body: PutFoodsMeal | PutRestaurantMeal, constraint: str
) -> RequestValidationError | None:
    """The 422 for a failed foreign key, on the field the client sent. None if it is not one."""
    if constraint == FOOD_REFERENCE:
        return invalid_field(("body", "food_entries"), "A Food here does not exist.")
    if constraint in RESTAURANT_REFERENCES and isinstance(body, PutRestaurantMeal):
        # meals.restaurant_id is checked first, so either constraint can mean any Restaurant.
        return invalid_field(("body", body.restaurants_field), "A Restaurant here does not exist.")
    return None


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
        from_day: Annotated[Day | None, Query(alias="from")] = None,
        to_day: Annotated[Day | None, Query(alias="to")] = None,
        food_id: UUID | None = None,
        cursor: str | None = None,
        limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
    ) -> MealPage:
        where, params = range_filters("m", from_day, to_day, cursor)
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
        description="Read one Meal with its Food Entries or Restaurants.",
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
            refused = reference_error(body, violated_constraint(error))
            if refused is None:
                raise
            raise refused from None
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
        description="Delete a Meal and its Food Entries or Restaurants.",
    )
    def delete_meal(meal_id: UUID, user: CurrentUser, session: DbSession) -> None:
        # Its Food Entries or Restaurants go with it, by the foreign keys' ON DELETE CASCADE.
        session.execute(
            text("DELETE FROM meals WHERE id = :id AND user_id = :user"),
            {"id": meal_id, "user": user},
        )
        session.commit()

    return router
