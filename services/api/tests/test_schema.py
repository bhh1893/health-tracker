"""Proves Postgres itself rejects bad data (ADR 0002), as the limited role `api` uses.

Each rejection names the constraint it expects, so a test cannot pass because some other
rule happened to fire first.
"""

from typing import Any
from uuid import UUID

import pytest
from sqlalchemy import Engine, text
from sqlalchemy.exc import IntegrityError, ProgrammingError
from sqlalchemy.orm import Session

CHECK_VIOLATION = "23514"
FOREIGN_KEY_VIOLATION = "23503"
# ON DELETE RESTRICT has its own code, separate from the general foreign key one.
RESTRICT_VIOLATION = "23001"
UNIQUE_VIOLATION = "23505"
INSUFFICIENT_PRIVILEGE = "42501"

WHEN = {"occurred_at": "2026-11-03T12:00:00+00:00", "occurred_tz": "UTC", "day": "2026-11-03"}


def insert(session: Session, table: str, **values: Any) -> UUID:
    columns = ", ".join(values)
    placeholders = ", ".join(f":{column}" for column in values)
    statement = f"INSERT INTO {table} ({columns}) VALUES ({placeholders}) RETURNING id"
    return session.execute(text(statement), values).scalar_one()


def new_user(session: Session) -> UUID:
    return session.execute(text("INSERT INTO users DEFAULT VALUES RETURNING id")).scalar_one()


def foods_meal(session: Session, user: UUID) -> UUID:
    return insert(session, "meals", user_id=user, kind="foods", **WHEN)


def restaurant_meal(session: Session, user: UUID) -> UUID:
    restaurant = insert(session, "restaurants", user_id=user, name="Diner")
    return insert(
        session, "meals", user_id=user, kind="restaurant", restaurant_id=restaurant, **WHEN
    )


def food_entry(session: Session, user: UUID, meal: UUID, food: UUID, **values: Any) -> UUID:
    return insert(
        session,
        "food_entries",
        user_id=user,
        meal_id=meal,
        food_id=food,
        **{"quantity": 100, "unit": "g", **values},
    )


def assert_rejected(caught: pytest.ExceptionInfo[IntegrityError], sqlstate: str, name: str) -> None:
    error: Any = caught.value.orig
    assert (error.sqlstate, error.diag.constraint_name) == (sqlstate, name)


@pytest.fixture
def user(session: Session) -> UUID:
    return new_user(session)


@pytest.fixture
def other_user(session: Session) -> UUID:
    return new_user(session)


def test_a_valid_meal_with_food_entries_is_accepted(session: Session, user: UUID) -> None:
    food = insert(session, "foods", user_id=user, name="Rice")

    food_entry(session, user, foods_meal(session, user), food)

    assert session.scalar(text("SELECT count(*) FROM food_entries")) == 1


def test_keys_default_to_uuidv7(session: Session, user: UUID) -> None:
    assert insert(session, "foods", user_id=user, name="Rice").version == 7


def test_cannot_log_another_users_food(session: Session, user: UUID, other_user: UUID) -> None:
    food = insert(session, "foods", user_id=other_user, name="Rice")
    meal = foods_meal(session, user)

    with pytest.raises(IntegrityError) as caught:
        food_entry(session, user, meal, food)

    assert_rejected(caught, FOREIGN_KEY_VIOLATION, "food_entries_food_id_user_id_fkey")


def test_cannot_add_to_another_users_meal(session: Session, user: UUID, other_user: UUID) -> None:
    food = insert(session, "foods", user_id=user, name="Rice")
    meal = foods_meal(session, other_user)

    with pytest.raises(IntegrityError) as caught:
        food_entry(session, user, meal, food)

    assert_rejected(caught, FOREIGN_KEY_VIOLATION, "food_entries_meal_id_user_id_fkey")


def test_cannot_log_another_users_exercise(session: Session, user: UUID, other_user: UUID) -> None:
    exercise = insert(session, "exercises", user_id=other_user, name="Squat")

    with pytest.raises(IntegrityError) as caught:
        insert(session, "exercise_entries", user_id=user, exercise_id=exercise, reps=5, **WHEN)

    assert_rejected(caught, FOREIGN_KEY_VIOLATION, "exercise_entries_exercise_id_user_id_fkey")


def test_cannot_use_another_users_restaurant(
    session: Session, user: UUID, other_user: UUID
) -> None:
    restaurant = insert(session, "restaurants", user_id=other_user, name="Diner")

    with pytest.raises(IntegrityError) as caught:
        insert(session, "meals", user_id=user, kind="restaurant", restaurant_id=restaurant, **WHEN)

    assert_rejected(caught, FOREIGN_KEY_VIOLATION, "meals_restaurant_id_user_id_fkey")


def test_food_entry_cannot_join_a_restaurant_meal(session: Session, user: UUID) -> None:
    food = insert(session, "foods", user_id=user, name="Rice")
    meal = restaurant_meal(session, user)

    with pytest.raises(IntegrityError) as caught:
        food_entry(session, user, meal, food)

    assert_rejected(caught, FOREIGN_KEY_VIOLATION, "food_entries_meal_id_meal_kind_fkey")


def test_food_entry_cannot_claim_a_restaurant_kind(session: Session, user: UUID) -> None:
    """The lie that would get past the FK above: only the CHECK stops it."""
    food = insert(session, "foods", user_id=user, name="Rice")
    meal = restaurant_meal(session, user)

    with pytest.raises(IntegrityError) as caught:
        food_entry(session, user, meal, food, meal_kind="restaurant")

    assert_rejected(caught, CHECK_VIOLATION, "food_entries_meal_kind_check")


def test_foods_meal_cannot_have_a_restaurant(session: Session, user: UUID) -> None:
    restaurant = insert(session, "restaurants", user_id=user, name="Diner")

    with pytest.raises(IntegrityError) as caught:
        insert(session, "meals", user_id=user, kind="foods", restaurant_id=restaurant, **WHEN)

    assert_rejected(caught, CHECK_VIOLATION, "meals_restaurant_matches_kind")


def test_restaurant_meal_needs_a_restaurant(session: Session, user: UUID) -> None:
    with pytest.raises(IntegrityError) as caught:
        insert(session, "meals", user_id=user, kind="restaurant", **WHEN)

    assert_rejected(caught, CHECK_VIOLATION, "meals_restaurant_matches_kind")


def test_meal_with_food_entries_cannot_change_kind(session: Session, user: UUID) -> None:
    restaurant = insert(session, "restaurants", user_id=user, name="Diner")
    food = insert(session, "foods", user_id=user, name="Rice")
    meal = foods_meal(session, user)
    food_entry(session, user, meal, food)

    with pytest.raises(IntegrityError) as caught:
        session.execute(
            text(
                "UPDATE meals SET kind = 'restaurant', restaurant_id = :restaurant WHERE id = :id"
            ),
            {"restaurant": restaurant, "id": meal},
        )

    assert_rejected(caught, FOREIGN_KEY_VIOLATION, "food_entries_meal_id_meal_kind_fkey")


@pytest.mark.parametrize("table", ["foods", "exercises", "restaurants"])
def test_duplicate_name_is_rejected_ignoring_case(session: Session, user: UUID, table: str) -> None:
    insert(session, table, user_id=user, name="Brown Rice")

    with pytest.raises(IntegrityError) as caught:
        insert(session, table, user_id=user, name="brown rice")

    assert_rejected(caught, UNIQUE_VIOLATION, f"{table}_user_name_key")


def test_archived_item_still_holds_its_name(session: Session, user: UUID) -> None:
    insert(session, "foods", user_id=user, name="Rice", archived_at="2026-11-01T00:00:00+00:00")

    with pytest.raises(IntegrityError) as caught:
        insert(session, "foods", user_id=user, name="Rice")

    assert_rejected(caught, UNIQUE_VIOLATION, "foods_user_name_key")


def test_two_users_can_share_a_name(session: Session, user: UUID, other_user: UUID) -> None:
    insert(session, "foods", user_id=user, name="Rice")
    insert(session, "foods", user_id=other_user, name="Rice")

    assert session.scalar(text("SELECT count(*) FROM foods")) == 2


def test_used_food_cannot_be_deleted(session: Session, user: UUID) -> None:
    food = insert(session, "foods", user_id=user, name="Rice")
    food_entry(session, user, foods_meal(session, user), food)

    with pytest.raises(IntegrityError) as caught:
        session.execute(text("DELETE FROM foods WHERE id = :id"), {"id": food})

    assert_rejected(caught, RESTRICT_VIOLATION, "food_entries_food_id_user_id_fkey")


def test_used_exercise_cannot_be_deleted(session: Session, user: UUID) -> None:
    exercise = insert(session, "exercises", user_id=user, name="Squat")
    insert(session, "exercise_entries", user_id=user, exercise_id=exercise, reps=5, **WHEN)

    with pytest.raises(IntegrityError) as caught:
        session.execute(text("DELETE FROM exercises WHERE id = :id"), {"id": exercise})

    assert_rejected(caught, RESTRICT_VIOLATION, "exercise_entries_exercise_id_user_id_fkey")


def test_used_restaurant_cannot_be_deleted(session: Session, user: UUID) -> None:
    restaurant_meal(session, user)

    with pytest.raises(IntegrityError) as caught:
        session.execute(text("DELETE FROM restaurants"))

    assert_rejected(caught, RESTRICT_VIOLATION, "meals_restaurant_id_user_id_fkey")


def test_never_used_food_can_be_deleted(session: Session, user: UUID) -> None:
    food = insert(session, "foods", user_id=user, name="Rice")

    session.execute(text("DELETE FROM foods WHERE id = :id"), {"id": food})

    assert session.scalar(text("SELECT count(*) FROM foods")) == 0


def test_deleting_a_meal_deletes_its_food_entries(session: Session, user: UUID) -> None:
    food = insert(session, "foods", user_id=user, name="Rice")
    meal = foods_meal(session, user)
    food_entry(session, user, meal, food)

    session.execute(text("DELETE FROM meals WHERE id = :id"), {"id": meal})

    assert session.scalar(text("SELECT count(*) FROM food_entries")) == 0


@pytest.mark.parametrize(
    ("values", "constraint"),
    [
        ({"quantity": 0}, "food_entries_quantity_check"),
        ({"unit": "oz"}, "food_entries_unit_check"),
    ],
)
def test_food_entry_values_are_checked(
    session: Session, user: UUID, values: dict[str, Any], constraint: str
) -> None:
    food = insert(session, "foods", user_id=user, name="Rice")
    meal = foods_meal(session, user)

    with pytest.raises(IntegrityError) as caught:
        food_entry(session, user, meal, food, **values)

    assert_rejected(caught, CHECK_VIOLATION, constraint)


@pytest.mark.parametrize(
    ("values", "constraint"),
    [
        ({"reps": 0}, "exercise_entries_reps_check"),
        ({"reps": 5, "weight_lb": 0}, "exercise_entries_weight_lb_check"),
    ],
)
def test_exercise_entry_values_are_checked(
    session: Session, user: UUID, values: dict[str, Any], constraint: str
) -> None:
    exercise = insert(session, "exercises", user_id=user, name="Squat")

    with pytest.raises(IntegrityError) as caught:
        insert(session, "exercise_entries", user_id=user, exercise_id=exercise, **values, **WHEN)

    assert_rejected(caught, CHECK_VIOLATION, constraint)


def test_bodyweight_set_has_no_weight(session: Session, user: UUID) -> None:
    exercise = insert(session, "exercises", user_id=user, name="Pull-up")

    insert(session, "exercise_entries", user_id=user, exercise_id=exercise, reps=8, **WHEN)

    assert session.scalar(text("SELECT weight_lb FROM exercise_entries")) is None


@pytest.mark.parametrize(
    "statement",
    [
        "DROP TABLE meals",
        "ALTER TABLE food_entries DROP CONSTRAINT food_entries_meal_id_meal_kind_fkey",
        "ALTER TABLE meals DISABLE TRIGGER ALL",
        "DROP INDEX foods_user_name_key",
        "CREATE INDEX sneaky ON foods (name)",
        "TRUNCATE exercise_entries",
    ],
)
def test_api_rw_cannot_weaken_the_schema(api_rw_engine: Engine, statement: str) -> None:
    with api_rw_engine.connect() as connection, pytest.raises(ProgrammingError) as caught:
        connection.execute(text(statement))

    assert getattr(caught.value.orig, "sqlstate", None) == INSUFFICIENT_PRIVILEGE


@pytest.mark.parametrize(
    ("index", "definition"),
    [
        ("meals_user_day", "(user_id, day, occurred_at, id)"),
        ("exercise_entries_user_day", "(user_id, day, occurred_at, id)"),
        ("exercise_entries_user_exercise_day", "(user_id, exercise_id, day, occurred_at, id)"),
        ("food_entries_meal", "(meal_id)"),
        ("food_entries_user_food", "(user_id, food_id) INCLUDE (meal_id)"),
        ("foods_name_trgm", "gin (lower(name) gin_trgm_ops)"),
        ("exercises_name_trgm", "gin (lower(name) gin_trgm_ops)"),
        ("restaurants_name_trgm", "gin (lower(name) gin_trgm_ops)"),
    ],
)
def test_adr_0012_indexes_exist(session: Session, index: str, definition: str) -> None:
    created = session.scalar(
        text("SELECT indexdef FROM pg_indexes WHERE indexname = :index"), {"index": index}
    )

    assert created is not None
    assert created.endswith(definition)
