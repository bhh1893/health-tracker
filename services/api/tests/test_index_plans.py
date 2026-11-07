"""Proves the v1 queries use their indexes at multi-user scale (ADR 0012, ADR 0014).

Not part of the PR suite: on small tables the planner rightly reads them whole, so this needs
the full seed. It runs weekly and by hand:

    uv run pytest -m index_plans

The SQL is never copied here. Each case sends a real request and explains the statements the
API actually ran, so a query that changes is checked as it now is, not as it once was.

Asserts plan shape only, never timings: those vary with the machine (ADR 0014).
"""

import os
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from textwrap import dedent
from typing import Any, cast
from urllib.parse import quote
from uuid import uuid7

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from seed import seed_database
from sqlalchemy import URL, Connection, Engine, event, text

from health_api.identity import SEEDED_USER_ID
from health_api.main import create_app

pytestmark = pytest.mark.index_plans

ENTRY_TABLES = {"meals", "food_entries", "exercise_entries"}
# Far enough above the small-table regime that a plan here means something.
MIN_SEEDED_SETS = 1_000_000


@dataclass(frozen=True)
class Case:
    name: str
    path: str
    # Only the indexes ADR 0012 designed. Looking one row up by id can use any of a table's
    # equally good unique indexes, so naming those would fail on a coin toss.
    indexes: tuple[str, ...]
    method: str = "GET"
    body_name: str | None = None
    status: int = 200


CASES = (
    Case("Meals on a Day", "/meals?from={day}&to={day}", ("meals_user_day", "food_entries_meal")),
    Case("Meals newest first", "/meals", ("meals_user_day", "food_entries_meal")),
    Case("Meals next page", "/meals?cursor={meal_cursor}", ("meals_user_day",)),
    Case("Meals with a common Food", "/meals?food_id={common_food}", ("food_entries_user_food",)),
    Case("Meals with a rare Food", "/meals?food_id={rare_food}", ("food_entries_user_food",)),
    Case("One Meal", "/meals/{meal}", ("food_entries_meal",)),
    Case("Sets on a Day", "/exercise-entries?from={day}&to={day}", ("exercise_entries_user_day",)),
    Case("Sets newest first", "/exercise-entries", ("exercise_entries_user_day",)),
    Case(
        "Sets next page", "/exercise-entries?cursor={entry_cursor}", ("exercise_entries_user_day",)
    ),
    Case(
        "Sets of an Exercise",
        "/exercise-entries?exercise_id={exercise}",
        ("exercise_entries_user_exercise_day",),
    ),
    Case(
        "Last N Sessions",
        "/exercises/{exercise}/sessions",
        ("exercise_entries_user_exercise_day",),
    ),
    Case("Recent Foods", "/foods", ("food_entries_user_food",)),
    Case("Recent Exercises", "/exercises", ("exercise_entries_user_exercise_day",)),
    Case("Recent Restaurants", "/restaurants", ("meals_user_day",)),
    Case("Foods typeahead, short", "/foods?q=gr", ("foods_name_trgm",)),
    Case("Foods typeahead, typo", "/foods?q=chiken", ("foods_name_trgm",)),
    Case("Exercises typeahead", "/exercises?q=barbel", ("exercises_user_name_key",)),
    Case("Restaurants typeahead", "/restaurants?q=kitchn", ("restaurants_user_name_key",)),
    Case(
        "Foods near-duplicate",
        "/foods/{new_id}",
        ("foods_name_trgm",),
        method="PUT",
        body_name="{near_food}",
        status=409,
    ),
    Case(
        "Exercises near-duplicate",
        "/exercises/{new_id}",
        ("exercises_user_name_key",),
        method="PUT",
        body_name="{near_exercise}",
        status=409,
    ),
    Case(
        "Restaurants near-duplicate",
        "/restaurants/{new_id}",
        ("restaurants_user_name_key",),
        method="PUT",
        body_name="{near_restaurant}",
        status=409,
    ),
)


@dataclass(frozen=True)
class Statement:
    sql: str
    parameters: Any


@pytest.fixture(scope="module")
def seeded(role_urls: dict[str, URL], migrated: None) -> None:
    url = role_urls["app"].set(drivername="postgresql")
    seed_database(url.render_as_string(hide_password=False))


@pytest.fixture(scope="module")
def api(role_urls: dict[str, URL], seeded: None) -> Iterator[TestClient]:
    """The real app with its real engine, as api_rw: what production runs, not a test session."""
    url = role_urls["api_rw"].set(drivername="postgresql")
    with pytest.MonkeyPatch.context() as patch:
        patch.setenv("DATABASE_URL", url.render_as_string(hide_password=False))
        with TestClient(create_app()) as client:
            yield client


@pytest.fixture(scope="module")
def engine(api: TestClient) -> Engine:
    return cast(FastAPI, api.app).state.engine


@pytest.fixture(scope="module")
def targets(api: TestClient, engine: Engine) -> dict[str, str]:
    """Real rows of the API's user, for the cases to ask about."""

    def one(sql: str) -> str:
        with engine.connect() as connection:
            return str(connection.execute(text(sql), {"user": SEEDED_USER_ID}).scalar_one())

    def used(table: str, column: str, direction: str) -> str:
        return one(
            f"""
            SELECT {column} FROM {table} WHERE user_id = :user
            GROUP BY {column} ORDER BY count(*) {direction}, {column} LIMIT 1
            """
        )

    def cursor(path: str) -> str:
        return quote(api.get(f"/api/v1{path}?limit=2").json()["next_cursor"])

    def near(table: str) -> str:
        # One extra letter: not the same name, but well above the similarity threshold.
        return one(f"SELECT name || 's' FROM {table} WHERE user_id = :user ORDER BY name LIMIT 1")

    return {
        "day": one("SELECT max(day) FROM exercise_entries WHERE user_id = :user"),
        "meal": one("SELECT max(id::text) FROM meals WHERE user_id = :user AND kind = 'foods'"),
        "common_food": used("food_entries", "food_id", "DESC"),
        "rare_food": used("food_entries", "food_id", "ASC"),
        "exercise": used("exercise_entries", "exercise_id", "DESC"),
        "meal_cursor": cursor("/meals"),
        "entry_cursor": cursor("/exercise-entries"),
        "near_food": near("foods"),
        "near_exercise": near("exercises"),
        "near_restaurant": near("restaurants"),
        "new_id": str(uuid7()),
    }


@pytest.fixture(scope="module")
def report() -> Iterator[list[str]]:
    """Collects each plan as text. Set INDEX_PLANS_REPORT to keep them in a file."""
    sections: list[str] = []
    yield sections
    path = os.environ.get("INDEX_PLANS_REPORT")
    if path:
        Path(path).write_text("\n".join(sections))


def run_case(
    case: Case, api: TestClient, engine: Engine, targets: dict[str, str]
) -> list[Statement]:
    """Sends the case's request and returns the SQL it ran, parameters and all."""
    statements: list[Statement] = []

    def record(
        _connection: Connection,
        _cursor: object,
        sql: str,
        parameters: Any,
        _context: object,
        _executemany: bool,
    ) -> None:
        statements.append(Statement(sql, parameters))

    body = {"name": case.body_name.format_map(targets)} if case.body_name else None
    event.listen(engine, "before_cursor_execute", record)
    try:
        response = api.request(case.method, "/api/v1" + case.path.format_map(targets), json=body)
    finally:
        event.remove(engine, "before_cursor_execute", record)

    assert response.status_code == case.status, response.text
    # A query that matched nothing has proved nothing.
    assert response.json() not in ([], {"items": [], "next_cursor": None})
    return statements


def plan_nodes(node: dict[str, Any]) -> Iterator[dict[str, Any]]:
    yield node
    for child in node.get("Plans", []):
        yield from plan_nodes(child)


def text_plan(connection: Connection, statement: Statement) -> str:
    """The plan with real timings, from a second run so that it reads from a warm cache."""
    explain = "EXPLAIN (ANALYZE, BUFFERS) " + statement.sql
    connection.exec_driver_sql(explain, statement.parameters).all()
    rows = connection.exec_driver_sql(explain, statement.parameters).all()
    return "\n".join(row[0] for row in rows)


def test_seed_is_at_full_scale(engine: Engine) -> None:
    with engine.connect() as connection:
        sets = connection.execute(text("SELECT count(*) FROM exercise_entries")).scalar_one()

    assert sets > MIN_SEEDED_SETS


@pytest.mark.parametrize("case", CASES, ids=lambda case: case.name)
def test_query_uses_its_indexes(
    case: Case,
    api: TestClient,
    engine: Engine,
    targets: dict[str, str],
    report: list[str],
) -> None:
    indexes: set[str] = set()
    sequential: set[str] = set()
    report.append(f"## {case.name}\n")

    with engine.connect() as connection:
        for statement in run_case(case, api, engine, targets):
            # A threshold the query reads, set in the same transaction the API used.
            if statement.sql.startswith("SET"):
                connection.exec_driver_sql(statement.sql)
                continue
            explain = "EXPLAIN (FORMAT JSON) " + statement.sql
            plan = connection.exec_driver_sql(explain, statement.parameters).scalar_one()
            nodes = list(plan_nodes(plan[0]["Plan"]))
            indexes |= {node["Index Name"] for node in nodes if "Index Name" in node}
            sequential |= {
                node["Relation Name"] for node in nodes if node["Node Type"] == "Seq Scan"
            }
            sql = dedent(statement.sql.strip("\n"))
            report.append(f"```sql\n{sql}\n```\n\n```\n{text_plan(connection, statement)}\n```\n")
        connection.rollback()

    assert not sequential & ENTRY_TABLES
    assert set(case.indexes) <= indexes, f"used {sorted(indexes)}"
