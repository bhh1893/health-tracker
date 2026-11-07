"""Schemathesis: generated requests against the real API and Postgres (ADR 0014).

Run with `pytest -m fuzz`. Left alone, the generator stops at validation: it cannot guess a
timezone name or a Catalog item that exists, so almost nothing would reach the SQL. The hook
below makes valid requests look like real ones. Invalid ones go through untouched.
"""

# Schemathesis's own signatures are partly untyped, which strict mode reports at each use.
# pyright: reportUnknownMemberType=false, reportUnknownVariableType=false
# pyright: reportUntypedFunctionDecorator=false

from typing import Any
from uuid import UUID
from zoneinfo import available_timezones

import pytest
import schemathesis
from fastapi.testclient import TestClient
from hypothesis import strategies as st
from schemathesis import BaseSchema, Case, GenerationMode, HookContext
from schemathesis.specs.openapi.checks import positive_data_acceptance

from health_api.main import create_app

pytestmark = pytest.mark.fuzz

FOOD = "019a0000-0000-7000-8000-0000000000f1"
EXERCISE = "019a0000-0000-7000-8000-0000000000f2"
RESTAURANT = "019a0000-0000-7000-8000-0000000000f3"
FOODS_MEAL = "019a0000-0000-7000-8000-0000000000f4"
RESTAURANT_MEAL = "019a0000-0000-7000-8000-0000000000f5"
EXERCISE_ENTRY = "019a0000-0000-7000-8000-0000000000f6"
OCCURRED = {"occurred_at": "2026-01-01T12:00:00Z", "occurred_tz": "UTC"}

REFERENCES = {"food_id": FOOD, "exercise_id": EXERCISE, "restaurant_id": RESTAURANT}
# What a path ID can be pointed at, so reads see real rows and writes see conflicts.
SEEDED_ROWS = {
    "/api/v1/foods/{item_id}": FOOD,
    "/api/v1/exercises/{item_id}": EXERCISE,
    "/api/v1/exercises/{exercise_id}/sessions": EXERCISE,
    "/api/v1/restaurants/{item_id}": RESTAURANT,
    "/api/v1/meals/{meal_id}": FOODS_MEAL,
    "/api/v1/exercise-entries/{entry_id}": EXERCISE_ENTRY,
}
# Deleting these would free the Catalog items, and every later body reference would be a 422.
KEEP_ROWS = {"/api/v1/meals/{meal_id}", "/api/v1/exercise-entries/{entry_id}"}
TIMEZONES = sorted(available_timezones())

# `format: uuid7` is ours to explain: the generator only knows the older formats, and without
# this sends any text at all. Built from an integer so Hypothesis can replay and shrink it.
schemathesis.openapi.format(
    "uuid7", st.integers(0, 2**128 - 1).map(lambda number: str(UUID(int=number, version=7)))
)


def make_realistic(value: Any, timezone: str) -> None:
    """Rewrite, in place and at any depth, the body fields only the server can validate."""
    if isinstance(value, list):
        for item in value:
            make_realistic(item, timezone)
    elif isinstance(value, dict):
        for key, field in value.items():
            if key in REFERENCES:
                value[key] = REFERENCES[key]
            elif key == "occurred_tz":
                value[key] = timezone
            elif key == "occurred_at":
                # Years run to 9999, and the future is refused. Early years stay: they are
                # where timezone math overflows.
                value[key] = f"2000{field[4:]}" if field[:4] > "2000" else field
            else:
                make_realistic(field, timezone)


@schemathesis.hook
def flatmap_case(_: HookContext, case: Case[Any]) -> Any:
    if case.meta is None or case.meta.generation.mode is not GenerationMode.POSITIVE:
        return st.just(case)

    def apply(timezone: str, use_seeded_row: bool) -> Case[Any]:
        make_realistic(case.body, timezone)
        # Cursors are opaque, so a generated one only ever tests the same 422.
        case.query.pop("cursor", None)
        case.query.update({k: v for k, v in REFERENCES.items() if k in case.query})
        path = case.operation.path
        keep = case.method == "DELETE" and path in KEEP_ROWS
        if use_seeded_row and path in SEEDED_ROWS and not keep:
            case.path_parameters = dict.fromkeys(case.path_parameters, SEEDED_ROWS[path])
        return case

    return st.builds(apply, st.sampled_from(TIMEZONES), st.booleans())


@pytest.fixture
def api_schema(committing_client: TestClient) -> BaseSchema:
    """The contract the running app serves, with one of everything already in the database."""
    for path, row_id, body in (
        ("foods", FOOD, {"name": "Fuzz food"}),
        ("exercises", EXERCISE, {"name": "Fuzz exercise"}),
        ("restaurants", RESTAURANT, {"name": "Fuzz restaurant"}),
        (
            "meals",
            FOODS_MEAL,
            {
                **OCCURRED,
                "kind": "foods",
                "food_entries": [{"food_id": FOOD, "quantity": 1, "unit": "g"}],
            },
        ),
        (
            "meals",
            RESTAURANT_MEAL,
            {**OCCURRED, "kind": "restaurant", "restaurant_id": RESTAURANT},
        ),
        ("exercise-entries", EXERCISE_ENTRY, {**OCCURRED, "exercise_id": EXERCISE, "reps": 5}),
    ):
        committing_client.put(f"/api/v1/{path}/{row_id}", json=body).raise_for_status()
    return schemathesis.openapi.from_asgi("/openapi.json", create_app())


schema = schemathesis.pytest.from_fixture("api_schema")


@schema.parametrize()
def test_api_keeps_its_contract(case: Case[Any]) -> None:
    # Every default check but this one, which wants all schema-valid data accepted. Ours is
    # refused by design when it breaks a rule a schema cannot state, such as a missing Food.
    case.call_and_validate(excluded_checks=[positive_data_acceptance])
