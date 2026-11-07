"""The seed stays loadable as the schema changes. The full run is weekly, so catch it here."""

from typing import Any

from seed import COLUMNS, Scale, generate, load
from sqlalchemy import Engine, text

TINY = Scale(users=2, days=14)


def test_the_same_seed_makes_the_same_rows() -> None:
    assert list(generate(TINY)) == list(generate(TINY))


def test_rows_match_their_columns() -> None:
    for batch in generate(TINY):
        for table, rows in batch.items():
            assert {len(row) for row in rows} <= {len(COLUMNS[table])}


def test_seed_loads_into_the_real_schema(owner_engine: Engine) -> None:
    with owner_engine.connect() as connection:
        driver_connection: Any = connection.connection.driver_connection
        load(driver_connection, TINY)

        meals = connection.execute(text("SELECT count(*) FROM meals")).scalar_one()
        food_entries = connection.execute(text("SELECT count(*) FROM food_entries")).scalar_one()
        sets = connection.execute(text("SELECT count(*) FROM exercise_entries")).scalar_one()
        connection.rollback()

    assert meals == TINY.users * TINY.days * 3
    assert food_entries > meals
    assert sets > 0
