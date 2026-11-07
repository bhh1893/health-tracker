"""Synthetic data at multi-user scale, for the index plan checks (ADR 0012, ADR 0014).

Real data cannot prove the indexes: one user's rows fit in a few pages, so the planner rightly
reads whole tables. This fills a database with 100 users x 3 years at one real user's rates.

A fixed random seed makes every run the same data, so a plan that changes means the code,
the schema or Postgres changed, never the luck of the draw.

Lives in tests/, which the image leaves out: production has no use for a bulk loader.

    DATABASE_URL=postgresql://... uv run python tests/seed.py
"""

import os
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from itertools import accumulate
from random import Random
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

import psycopg
from psycopg import sql

from health_api.identity import SEEDED_USER_ID

RANDOM_SEED = 63
FIRST_DAY = date(2023, 1, 1)

# One real user's rates (ADR 0012): about 1,100 Meals and 7,000 Sets a year.
MEAL_TIMES = (time(8, 0), time(12, 30), time(19, 0))
RESTAURANT_SHARE = 0.1
FOOD_ENTRIES_PER_MEAL = (2, 5)
TRAINING_DAY_SHARE = 4 / 7
EXERCISES_PER_SESSION = 8
SETS_PER_EXERCISE = (4, 7)
WORKOUT_START = time(17, 0)
MINUTES_BETWEEN_SETS = 3

# "Hundreds of rows" per Catalog (ADR 0012).
FOODS_PER_USER = 200
EXERCISES_PER_USER = 60
RESTAURANTS_PER_USER = 30
ARCHIVED_SHARE = 0.05

TIMEZONES = ("America/New_York", "America/Los_Angeles", "Europe/London", "Asia/Tokyo")

# Users pick from one shared vocabulary, as real people do: many own a "chicken breast". That
# is the hard case for a trigram index that cannot see user_id, so it must not be seeded away.
# fmt: off
FOOD_STYLES = (
    "grilled", "baked", "raw", "fried", "roasted", "steamed", "smoked", "spicy", "sweet", "salted",
    "organic", "frozen", "fresh", "dried", "pickled", "mashed", "creamy", "crispy", "toasted",
    "plain",
)
FOOD_BASES = (
    "chicken", "beef", "pork", "salmon", "tuna", "shrimp", "turkey", "tofu", "eggs", "oats",
    "rice", "pasta", "bread", "potato", "broccoli", "spinach", "kale", "carrots", "beans",
    "lentils", "apple", "banana", "berries", "yogurt", "cheese", "milk", "almonds", "peanuts",
    "avocado", "butter",
)
EXERCISE_STYLES = (
    "barbell", "dumbbell", "cable", "machine", "kettlebell", "incline", "decline", "seated",
    "standing", "single-arm",
)
EXERCISE_BASES = (
    "squat", "deadlift", "lunge", "row", "press", "curl", "raise", "fly", "pulldown", "extension",
    "shrug", "crunch", "pullover", "dip", "thruster",
)
RESTAURANT_STYLES = (
    "golden", "blue", "lucky", "royal", "corner", "urban", "happy", "little", "grand", "sunny",
    "old", "new", "red", "green", "silver",
)
RESTAURANT_BASES = (
    "kitchen", "diner", "grill", "cafe", "bistro", "taqueria", "noodles", "pizza", "sushi", "deli",
)
# fmt: on
FOOD_NAMES = tuple(f"{style} {base}" for style in FOOD_STYLES for base in FOOD_BASES)
EXERCISE_NAMES = tuple(f"{style} {base}" for style in EXERCISE_STYLES for base in EXERCISE_BASES)
RESTAURANT_NAMES = tuple(
    f"{style} {base}" for style in RESTAURANT_STYLES for base in RESTAURANT_BASES
)

# Parents before children, so foreign keys hold as each table loads.
COLUMNS = {
    "users": ("id",),
    "foods": ("id", "user_id", "name", "archived_at"),
    "exercises": ("id", "user_id", "name", "archived_at"),
    "restaurants": ("id", "user_id", "name", "archived_at"),
    "meals": ("id", "user_id", "kind", "restaurant_id", "occurred_at", "occurred_tz", "day"),
    "food_entries": ("user_id", "meal_id", "food_id", "quantity", "unit"),
    "exercise_entries": (
        "id",
        "user_id",
        "exercise_id",
        "reps",
        "weight_lb",
        "occurred_at",
        "occurred_tz",
        "day",
    ),
}

type Batch = dict[str, list[tuple[Any, ...]]]


@dataclass(frozen=True)
class Scale:
    users: int = 100
    days: int = 3 * 365


@dataclass(frozen=True)
class User:
    id: UUID
    timezone: ZoneInfo
    foods: list[UUID]
    exercises: list[UUID]
    restaurants: list[UUID]


def uuid7_at(rng: Random, moment: datetime) -> UUID:
    """A UUIDv7 for `moment`, with the random bits from `rng` so that it repeats between runs.

    uuid.uuid7() would use the clock and the OS. The time prefix matters: it is why real ids
    sort by age, and so it is what a primary key index looks like on real data.
    """
    milliseconds = int(moment.timestamp() * 1000)
    return UUID(
        int=(milliseconds << 80)
        | (0x7 << 76)
        | (rng.getrandbits(12) << 64)
        | (0b10 << 62)
        | rng.getrandbits(62)
    )


def usage_weights(count: int) -> list[float]:
    """Cumulative Zipf weights: people eat a few things constantly and the rest rarely."""
    return list(accumulate(1 / rank for rank in range(1, count + 1)))


def catalog_rows(
    rng: Random, user: UUID, names: tuple[str, ...], count: int, created: datetime
) -> list[tuple[Any, ...]]:
    return [
        (uuid7_at(rng, created), user, name, created if rng.random() < ARCHIVED_SHARE else None)
        for name in rng.sample(names, count)
    ]


def meal_rows(rng: Random, user: User, day: date, weights: list[float], batch: Batch) -> None:
    for meal_time in MEAL_TIMES:
        jitter = timedelta(minutes=rng.randint(-45, 45))
        moment = datetime.combine(day, meal_time, user.timezone) + jitter
        meal_id = uuid7_at(rng, moment)
        restaurant = None
        if rng.random() < RESTAURANT_SHARE:
            restaurant = rng.choice(user.restaurants)
        kind = "foods" if restaurant is None else "restaurant"
        tz = user.timezone.key
        batch["meals"].append((meal_id, user.id, kind, restaurant, moment, tz, day))
        if restaurant is None:
            count = rng.randint(*FOOD_ENTRIES_PER_MEAL)
            for food in rng.choices(user.foods, cum_weights=weights, k=count):
                quantity = rng.randint(10, 400)
                unit = rng.choice(("g", "count"))
                batch["food_entries"].append((user.id, meal_id, food, quantity, unit))


def session_rows(rng: Random, user: User, day: date, weights: list[float], batch: Batch) -> None:
    moment = datetime.combine(day, WORKOUT_START, user.timezone)
    picked = {*rng.choices(user.exercises, cum_weights=weights, k=EXERCISES_PER_SESSION)}
    # Sorted: a set's order is not stable between runs, and the seed must be.
    for exercise in sorted(picked):
        weight = rng.choice((None, *range(20, 300, 5)))
        for _ in range(rng.randint(*SETS_PER_EXERCISE)):
            moment += timedelta(minutes=MINUTES_BETWEEN_SETS)
            batch["exercise_entries"].append(
                (
                    uuid7_at(rng, moment),
                    user.id,
                    exercise,
                    rng.randint(3, 15),
                    weight,
                    moment,
                    user.timezone.key,
                    day,
                )
            )


def generate(scale: Scale) -> Iterator[Batch]:
    """Yields the users and Catalogs, then one Batch per Day.

    Day by day, every user interleaved, because that is how rows reach a real table. Loading
    one user at a time would pack each user's rows together on disk, and the planner would
    see index scans as cheaper than they will ever be.
    """
    rng = Random(RANDOM_SEED)
    created = datetime.combine(FIRST_DAY, time(0, 0), UTC)
    catalogs: Batch = {table: [] for table in ("users", "foods", "exercises", "restaurants")}
    users: list[User] = []
    for index in range(scale.users):
        # The one user the API serves is among them, so real requests reach seeded rows.
        user_id = uuid7_at(rng, created) if index else SEEDED_USER_ID
        if index:
            catalogs["users"].append((user_id,))
        foods = catalog_rows(rng, user_id, FOOD_NAMES, FOODS_PER_USER, created)
        exercises = catalog_rows(rng, user_id, EXERCISE_NAMES, EXERCISES_PER_USER, created)
        restaurants = catalog_rows(rng, user_id, RESTAURANT_NAMES, RESTAURANTS_PER_USER, created)
        catalogs["foods"] += foods
        catalogs["exercises"] += exercises
        catalogs["restaurants"] += restaurants
        users.append(
            User(
                id=user_id,
                timezone=ZoneInfo(rng.choice(TIMEZONES)),
                foods=[row[0] for row in foods],
                exercises=[row[0] for row in exercises],
                restaurants=[row[0] for row in restaurants],
            )
        )
    yield catalogs

    food_weights = usage_weights(FOODS_PER_USER)
    exercise_weights = usage_weights(EXERCISES_PER_USER)
    for offset in range(scale.days):
        day = FIRST_DAY + timedelta(days=offset)
        batch: Batch = {"meals": [], "food_entries": [], "exercise_entries": []}
        for user in users:
            meal_rows(rng, user, day, food_weights, batch)
            if rng.random() < TRAINING_DAY_SHARE:
                session_rows(rng, user, day, exercise_weights, batch)
        yield batch


def load(connection: psycopg.Connection[Any], scale: Scale) -> None:
    """COPY, not INSERT: one stream per table, which is what makes millions of rows practical."""
    with connection.cursor() as cursor:
        for batch in generate(scale):
            for table, rows in batch.items():
                columns = sql.SQL(", ").join(map(sql.Identifier, COLUMNS[table]))
                statement = sql.SQL("COPY {} ({}) FROM STDIN").format(
                    sql.Identifier(table), columns
                )
                with cursor.copy(statement) as copy:
                    for row in rows:
                        copy.write_row(row)


def seed_database(url: str, scale: Scale | None = None) -> None:
    with psycopg.connect(url) as connection:
        load(connection, scale or Scale())
    # Outside any transaction, which VACUUM requires. ANALYZE gives the planner its statistics.
    # VACUUM marks pages all-visible, as autovacuum would have by now on a real table.
    with psycopg.connect(url, autocommit=True) as connection:
        connection.execute("VACUUM (ANALYZE)")


if __name__ == "__main__":
    seed_database(os.environ["DATABASE_URL"])
