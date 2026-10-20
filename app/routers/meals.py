from collections import defaultdict
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

from fastapi import APIRouter, Query, Response
from psycopg.errors import UniqueViolation

from ..db import pool
from ..errors import ApiError
from ..schemas.common import IsoDate
from ..schemas.errors import ERROR_RESPONSES
from ..schemas.meals import (
    DayOut,
    DayTotalsOut,
    ItemPatch,
    MealCreate,
    MealItemIn,
    MealOut,
    MealPatch,
)

router = APIRouter(prefix="/meals", tags=["meals"], responses=ERROR_RESPONSES)

MACRO_KEYS = ("calories", "protein_g", "fat_g", "carbs_g")
CENT = Decimal("0.01")
MAX_NUMERIC = Decimal("999999.99")  # largest value a numeric(8,2) column can hold
# Constant column list (never user input). food_name is the snapshot, exposed as "name".
ITEM_COLS = "id, food_id, food_name AS name, quantity, unit, calories, protein_g, fat_g, carbs_g"


# ---------------------------------------------------------------- helpers

def to_decimal(x: float) -> Decimal:
    return Decimal(str(x)).quantize(CENT, rounding=ROUND_HALF_UP)


def sum_macros(rows) -> dict:
    return {k: sum((r[k] for r in rows), Decimal(0)) for k in MACRO_KEYS}


def ensure_fits(macros: dict) -> None:
    if any(v > MAX_NUMERIC for v in macros.values()):
        raise ApiError(400, "quantity_too_large", "Quantity is too large for this food")


def same_item(stored, item: MealItemIn) -> bool:
    """Is this stored food entry the same thing the request describes? (retry detection)"""
    return (
        stored["food_id"] == item.food_id
        and stored["unit"] == item.unit
        and stored["quantity"] == to_decimal(item.quantity)
    )


def build_meal(meal, items) -> dict:
    return {
        "id": meal["id"],
        "label": meal["label"],
        "position": meal["position"],
        "foods": items,
        "totals": sum_macros(items),
    }


def load_meal(conn, day: date, meal_id: UUID):
    meal = conn.execute(
        "SELECT id, label, position FROM meals WHERE id = %s AND day = %s",
        (meal_id, day),
    ).fetchone()
    if meal is None:
        return None
    items = conn.execute(
        "SELECT " + ITEM_COLS + " FROM meal_items WHERE meal_id = %s ORDER BY created_at, id",
        (meal_id,),
    ).fetchall()
    return build_meal(meal, items)


def load_day(conn, day: date) -> dict:
    meals = conn.execute(
        "SELECT id, label, position FROM meals WHERE day = %s ORDER BY position", (day,)
    ).fetchall()
    items = conn.execute(
        "SELECT meal_id, " + ITEM_COLS + " FROM meal_items "
        "WHERE meal_id IN (SELECT id FROM meals WHERE day = %s) ORDER BY created_at, id",
        (day,),
    ).fetchall()
    by_meal = defaultdict(list)
    for it in items:
        by_meal[it["meal_id"]].append(it)
    built = [build_meal(m, by_meal[m["id"]]) for m in meals]
    return {
        "date": day,
        "meals": built,
        "day_totals": sum_macros([m["totals"] for m in built]),
    }


def add_item(conn, meal_id: UUID, item: MealItemIn) -> None:
    """Insert one food entry, snapshotting its macros from the catalog right now."""
    # FOR SHARE: nobody can edit this food until our transaction ends, so the
    # basis we check is the basis we snapshot.
    food = conn.execute(
        "SELECT id, name, basis, calories, protein_g, fat_g, carbs_g, archived "
        "FROM foods WHERE id = %s FOR SHARE",
        (item.food_id,),
    ).fetchone()
    if food is None:
        raise ApiError(400, "unknown_food", f"No food with id {item.food_id}")
    if food["archived"]:
        raise ApiError(400, "food_archived", f"'{food['name']}' is archived")

    per_100g = food["basis"] == "per_100g"
    expected_unit = "g" if per_100g else "count"
    if item.unit != expected_unit:
        raise ApiError(
            400,
            "unit_mismatch",
            f"'{food['name']}' is measured {'per 100g' if per_100g else 'per item'}; "
            f"use unit '{expected_unit}'",
        )

    qty = to_decimal(item.quantity)
    factor = qty / 100 if per_100g else qty
    macros = {k: (food[k] * factor).quantize(CENT, rounding=ROUND_HALF_UP) for k in MACRO_KEYS}
    ensure_fits(macros)

    # clock_timestamp() (not now()) so entries added in one request keep their order:
    # now() is frozen at the start of the transaction.
    conn.execute(
        "INSERT INTO meal_items (id, meal_id, food_id, food_name, quantity, unit, "
        "calories, protein_g, fat_g, carbs_g, created_at) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, clock_timestamp())",
        (
            item.id,
            meal_id,
            food["id"],
            food["name"],
            qty,
            item.unit,
            macros["calories"],
            macros["protein_g"],
            macros["fat_g"],
            macros["carbs_g"],
        ),
    )


# ---------------------------------------------------------------- reads

@router.get("", response_model=list[DayTotalsOut])
def daily_totals(from_: IsoDate = Query(alias="from"), to: IsoDate = Query()):
    if to < from_:
        raise ApiError(400, "validation_failed", "'to' must not be before 'from'")
    if (to - from_).days > 366:
        raise ApiError(400, "validation_failed", "Range is limited to 366 days")
    with pool.connection() as conn:
        rows = conn.execute(
            "SELECT m.day AS date, COUNT(DISTINCT m.id) AS meal_count, "
            "COALESCE(SUM(i.calories), 0) AS calories, "
            "COALESCE(SUM(i.protein_g), 0) AS protein_g, "
            "COALESCE(SUM(i.fat_g), 0) AS fat_g, "
            "COALESCE(SUM(i.carbs_g), 0) AS carbs_g "
            "FROM meals m LEFT JOIN meal_items i ON i.meal_id = m.id "
            "WHERE m.day BETWEEN %s AND %s GROUP BY m.day ORDER BY m.day",
            (from_, to),
        ).fetchall()
    return [
        {
            "date": r["date"],
            "meal_count": r["meal_count"],
            "totals": {k: r[k] for k in MACRO_KEYS},
        }
        for r in rows
    ]


@router.get("/{day}", response_model=DayOut)
def get_day(day: IsoDate):
    with pool.connection() as conn:
        return load_day(conn, day)


# ---------------------------------------------------------------- writes

@router.post("/{day}", response_model=MealOut, status_code=201)
def create_meal(day: IsoDate, body: MealCreate, response: Response):
    try:
        with pool.connection() as conn:
            # Make sure the day row exists, then lock it. Concurrent creates for the
            # same day queue up here, so positions can't collide and a retry waits
            # for the original request to commit.
            conn.execute("INSERT INTO meal_days (day) VALUES (%s) ON CONFLICT DO NOTHING", (day,))
            conn.execute("SELECT day FROM meal_days WHERE day = %s FOR UPDATE", (day,))
            position = conn.execute(
                "SELECT COALESCE(MAX(position), 0) + 1 AS p FROM meals WHERE day = %s", (day,)
            ).fetchone()["p"]
            label = body.label or f"meal {position}"

            inserted = conn.execute(
                "INSERT INTO meals (id, day, position, label) VALUES (%s, %s, %s, %s) "
                "ON CONFLICT (id) DO NOTHING RETURNING id",
                (body.id, day, position, label),
            ).fetchone()

            if inserted is None:
                # This meal id already exists: a retry, or a clash. Compare, don't re-insert.
                existing = load_meal(conn, day, body.id)
                if existing is None or not replay_matches(existing, body):
                    raise ApiError(
                        409, "idempotency_conflict", "This id was already used for a different meal"
                    )
                response.status_code = 200
                return existing

            for item in body.foods:
                add_item(conn, body.id, item)
            return load_meal(conn, day, body.id)
    except UniqueViolation:
        raise ApiError(409, "idempotency_conflict", "An id in this request is already in use")


def replay_matches(existing: dict, body: MealCreate) -> bool:
    if body.label is not None and body.label != existing["label"]:
        return False
    have = {f["id"]: f for f in existing["foods"]}
    for item in body.foods:
        stored = have.get(item.id)
        if stored is None or not same_item(stored, item):
            return False
    return True


@router.post("/{day}/{meal_id}/foods", response_model=MealOut, status_code=201)
def add_food(day: IsoDate, meal_id: UUID, body: MealItemIn, response: Response):
    with pool.connection() as conn:
        # Lock the meal: appends (and retries) to the same meal run one at a time.
        locked = conn.execute(
            "SELECT 1 FROM meals WHERE id = %s AND day = %s FOR UPDATE", (meal_id, day)
        ).fetchone()
        if locked is None:
            raise ApiError(404, "not_found", "Meal not found")

        # Retry check first, so replaying an old request still works even if the
        # food has been archived since.
        stored = conn.execute(
            "SELECT meal_id, food_id, quantity, unit FROM meal_items WHERE id = %s", (body.id,)
        ).fetchone()
        if stored is not None:
            if stored["meal_id"] != meal_id or not same_item(stored, body):
                raise ApiError(
                    409, "idempotency_conflict", "This id was already used for a different entry"
                )
            response.status_code = 200
        else:
            add_item(conn, meal_id, body)
        return load_meal(conn, day, meal_id)


@router.patch("/{day}/{meal_id}", response_model=MealOut)
def rename_meal(day: IsoDate, meal_id: UUID, body: MealPatch):
    with pool.connection() as conn:
        row = conn.execute(
            "UPDATE meals SET label = %s WHERE id = %s AND day = %s RETURNING id",
            (body.label, meal_id, day),
        ).fetchone()
        if row is None:
            raise ApiError(404, "not_found", "Meal not found")
        return load_meal(conn, day, meal_id)


@router.delete("/{day}/{meal_id}", status_code=204)
def delete_meal(day: IsoDate, meal_id: UUID):
    # ON DELETE CASCADE removes the meal's food entries. Idempotent: always 204.
    with pool.connection() as conn:
        conn.execute("DELETE FROM meals WHERE id = %s AND day = %s", (meal_id, day))
    return Response(status_code=204)


@router.patch("/{day}/{meal_id}/foods/{item_id}", response_model=MealOut)
def change_quantity(day: IsoDate, meal_id: UUID, item_id: UUID, body: ItemPatch):
    with pool.connection() as conn:
        item = conn.execute(
            "SELECT i.id, i.quantity, i.calories, i.protein_g, i.fat_g, i.carbs_g "
            "FROM meal_items i JOIN meals m ON m.id = i.meal_id "
            "WHERE i.id = %s AND m.id = %s AND m.day = %s FOR UPDATE OF i",
            (item_id, meal_id, day),
        ).fetchone()
        if item is None:
            raise ApiError(404, "not_found", "Food entry not found")

        # Rescale the stored snapshot; do NOT re-read the current catalog values.
        new_qty = to_decimal(body.quantity)
        ratio = new_qty / item["quantity"]
        macros = {k: (item[k] * ratio).quantize(CENT, rounding=ROUND_HALF_UP) for k in MACRO_KEYS}
        ensure_fits(macros)
        conn.execute(
            "UPDATE meal_items SET quantity = %s, calories = %s, protein_g = %s, "
            "fat_g = %s, carbs_g = %s WHERE id = %s",
            (
                new_qty,
                macros["calories"],
                macros["protein_g"],
                macros["fat_g"],
                macros["carbs_g"],
                item_id,
            ),
        )
        return load_meal(conn, day, meal_id)


@router.delete("/{day}/{meal_id}/foods/{item_id}", status_code=204)
def delete_food(day: IsoDate, meal_id: UUID, item_id: UUID):
    with pool.connection() as conn:
        conn.execute(
            "DELETE FROM meal_items i USING meals m "
            "WHERE i.id = %s AND i.meal_id = m.id AND m.id = %s AND m.day = %s",
            (item_id, meal_id, day),
        )
    return Response(status_code=204)
