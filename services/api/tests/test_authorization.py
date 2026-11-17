"""Authorization, proven over every route the app has (ADR 0014, ADR 0021).

Authorization is the only wall between the internet and the data (ADR 0025), so these tests
fail closed: they walk the app's routes, and a route added later is tested without anyone
remembering to add it. A route they cannot classify fails until someone says how to test it.
"""

import re
from typing import Any

import pytest
from fastapi.routing import iter_route_contexts
from fastapi.testclient import TestClient
from identities import headers, insert_user
from sqlalchemy.orm import Session
from starlette.routing import Route

from health_api.main import create_app
from health_api.problems import PENDING_APPROVAL

Endpoint = tuple[str, str]  # (method, path template)


def walk_routes() -> list[Endpoint]:
    """Every (method, path) the app serves, with each router's prefix applied.

    `app.routes` holds an included router as one opaque entry, so it is walked the way
    FastAPI's own OpenAPI generator walks it. If FastAPI renames this, the import fails: the
    test breaks loudly instead of walking nothing.
    """
    endpoints: list[Endpoint] = []
    for context in iter_route_contexts(create_app().routes):
        # A Mount or WebSocket route has no methods to walk. Fail rather than skip it.
        route = context.original_route
        assert isinstance(route, Route), f"Cannot walk {route!r}: add support for it here."
        assert context.path and context.methods, f"Cannot walk {route!r}: no path or methods."
        endpoints.extend((method, context.path) for method in context.methods)
    return sorted(endpoints)


ENDPOINTS = walk_routes()

# The one allowlist (ADR 0014). Exempting a route means editing it here, in review.
PUBLIC: set[Endpoint] = {("GET", "/healthz"), ("GET", "/readyz")}
OPEN_TO_PENDING: set[Endpoint] = {("GET", "/api/me")}

# Any UUIDv7 fills a path parameter: auth must answer before the id is ever looked up.
SOME_ID = "019a0000-0000-7000-8000-0000000000c1"


def fill(path: str, value: str = SOME_ID) -> str:
    return re.sub(r"\{[^}]+\}", value, path)


def ids(endpoints: list[Endpoint]) -> list[str]:
    return [f"{method} {path}" for method, path in endpoints]


def test_the_allowlist_names_real_routes() -> None:
    # A renamed route would leave a stale entry that exempts nothing and hides the rename.
    assert set(ENDPOINTS) >= PUBLIC | OPEN_TO_PENDING


# Route walk: 401 with no identity, 403 for Pending

SIGNED_IN_ONLY = [e for e in ENDPOINTS if e not in PUBLIC]
APPROVED_ONLY = [e for e in SIGNED_IN_ONLY if e not in OPEN_TO_PENDING]


@pytest.mark.parametrize(("method", "path"), SIGNED_IN_ONLY, ids=ids(SIGNED_IN_ONLY))
def test_no_identity_is_a_401(anonymous_client: TestClient, method: str, path: str) -> None:
    # No body and no query: auth must refuse before validation, or a probe learns the shape.
    response = anonymous_client.request(method, fill(path))

    assert response.status_code == 401, response.text


@pytest.mark.parametrize(("method", "path"), APPROVED_ONLY, ids=ids(APPROVED_ONLY))
def test_pending_is_a_403_pending_approval(
    anonymous_client: TestClient, session: Session, method: str, path: str
) -> None:
    insert_user(session, "waiting", "pending")

    response = anonymous_client.request(method, fill(path), headers=headers("waiting"))

    assert response.status_code == 403, response.text
    assert response.json()["type"] == PENDING_APPROVAL


@pytest.mark.parametrize(("method", "path"), sorted(PUBLIC), ids=ids(sorted(PUBLIC)))
def test_public_routes_need_no_identity(
    anonymous_client: TestClient, method: str, path: str
) -> None:
    assert anonymous_client.request(method, path).status_code == 200


@pytest.mark.parametrize(
    ("method", "path"), sorted(OPEN_TO_PENDING), ids=ids(sorted(OPEN_TO_PENDING))
)
def test_open_to_pending_routes_answer_pending(
    anonymous_client: TestClient, session: Session, method: str, path: str
) -> None:
    insert_user(session, "waiting", "pending")

    response = anonymous_client.request(method, path, headers=headers("waiting"))

    assert response.status_code == 200, response.text


# Two-Member isolation: B cannot read, change or detect A's rows (IDOR)

A = headers("member-a")
B = headers("member-b")
OCCURRED = {"occurred_at": "2026-01-01T12:00:00Z", "occurred_tz": "UTC"}
# The Day of every A Entry. B logs nothing, so this date in B's response could only be A's.
A_DAY = "2026-01-01"

# Fixed ids, so the tables below can name them. The ids are A's; B's are generated.
FOOD = "019a0000-0000-7000-8000-0000000000a1"
EXERCISE = "019a0000-0000-7000-8000-0000000000a2"
RESTAURANT = "019a0000-0000-7000-8000-0000000000a3"
MEAL = "019a0000-0000-7000-8000-0000000000a4"
EXERCISE_ENTRY = "019a0000-0000-7000-8000-0000000000a5"
A_IDS = (FOOD, EXERCISE, RESTAURANT, MEAL, EXERCISE_ENTRY)

B_FOOD = "019a0000-0000-7000-8000-0000000000b1"
B_EXERCISE = "019a0000-0000-7000-8000-0000000000b2"


def meal_body(food: str) -> dict[str, Any]:
    return {
        **OCCURRED,
        "kind": "foods",
        "food_entries": [{"food_id": food, "quantity": 1, "unit": "g"}],
    }


def entry_body(exercise: str) -> dict[str, Any]:
    return {**OCCURRED, "exercise_id": exercise, "reps": 5}


# Each route that takes an id: A's id to aim it at, and the valid bodies B sends there. B's
# bodies point at B's own Catalog items and use names B has not taken, so the only thing wrong
# with B's request is whose id it names. A new id route fails test_every_id_route_is_covered
# until it is added here.
ID_ROUTES: dict[str, tuple[str, dict[str, dict[str, Any]]]] = {
    "/api/v1/foods/{item_id}": (FOOD, {"PUT": {"name": "Rice"}, "PATCH": {"name": "Rice"}}),
    "/api/v1/exercises/{item_id}": (EXERCISE, {"PUT": {"name": "Row"}, "PATCH": {"name": "Row"}}),
    "/api/v1/restaurants/{item_id}": (
        RESTAURANT,
        {"PUT": {"name": "Diner"}, "PATCH": {"name": "Diner"}},
    ),
    "/api/v1/meals/{meal_id}": (MEAL, {"PUT": meal_body(B_FOOD)}),
    "/api/v1/exercise-entries/{entry_id}": (EXERCISE_ENTRY, {"PUT": entry_body(B_EXERCISE)}),
    "/api/v1/exercises/{exercise_id}/sessions": (EXERCISE, {}),
}

# Each list, Day and search route: a query that finds A's rows when A asks. The same query
# from B must find none. A new one fails test_every_collection_route_is_covered until added.
COLLECTION_ROUTES: dict[str, dict[str, str]] = {
    "/api/v1/foods": {"q": "A food", "include_archived": "true"},
    "/api/v1/exercises": {"q": "A exercise", "include_archived": "true"},
    "/api/v1/restaurants": {"q": "A restaurant", "include_archived": "true"},
    "/api/v1/meals": {"food_id": FOOD},
    "/api/v1/exercise-entries": {"exercise_id": EXERCISE},
    "/api/v1/days": {"from": A_DAY, "to": A_DAY},
}
# Shared with every User by design (ADR 0014): the one exemption.
SHARED = {"/api/v1/reference-foods"}

ID_ENDPOINTS = [(m, p) for m, p in APPROVED_ONLY if "{" in p]
COLLECTION_ENDPOINTS = [
    (m, p) for m, p in APPROVED_ONLY if m == "GET" and "{" not in p and p.startswith("/api/v1/")
]


def test_every_id_route_is_covered() -> None:
    assert {p for _, p in ID_ENDPOINTS} == set(ID_ROUTES)


def test_every_collection_route_is_covered() -> None:
    assert {p for _, p in COLLECTION_ENDPOINTS} == set(COLLECTION_ROUTES) | SHARED


@pytest.fixture
def two_members(anonymous_client: TestClient, session: Session) -> TestClient:
    """A owns one of everything, B owns a Food and an Exercise to point its bodies at."""
    insert_user(session, "member-a", "member")
    insert_user(session, "member-b", "member")
    for path, body, who in (
        (f"/api/v1/foods/{FOOD}", {"name": "A food"}, A),
        (f"/api/v1/exercises/{EXERCISE}", {"name": "A exercise"}, A),
        (f"/api/v1/restaurants/{RESTAURANT}", {"name": "A restaurant"}, A),
        (f"/api/v1/meals/{MEAL}", meal_body(FOOD), A),
        (f"/api/v1/exercise-entries/{EXERCISE_ENTRY}", entry_body(EXERCISE), A),
        (f"/api/v1/foods/{B_FOOD}", {"name": "Lentils"}, B),
        (f"/api/v1/exercises/{B_EXERCISE}", {"name": "Squat"}, B),
    ):
        anonymous_client.put(path, json=body, headers=who).raise_for_status()
    return anonymous_client


def a_snapshot(client: TestClient) -> list[Any]:
    """Everything A owns, as A reads it."""
    return [
        client.get(f"/api/v1/{path}/{row_id}", headers=A).json()
        for path, row_id in (
            ("foods", FOOD),
            ("exercises", EXERCISE),
            ("restaurants", RESTAURANT),
            ("meals", MEAL),
            ("exercise-entries", EXERCISE_ENTRY),
        )
    ]


@pytest.mark.parametrize(("method", "path"), ID_ENDPOINTS, ids=ids(ID_ENDPOINTS))
def test_b_cannot_reach_as_id(two_members: TestClient, method: str, path: str) -> None:
    a_id, bodies = ID_ROUTES[path]
    before = a_snapshot(two_members)

    response = two_members.request(method, fill(path, a_id), json=bodies.get(method), headers=B)

    # 404, never 403: a 403 would confirm the id exists and is someone else's. DELETE gives
    # 204 as for a missing id (ADR 0006), which tells B just as little.
    expected = 204 if method == "DELETE" else 404
    assert response.status_code == expected, response.text
    assert a_snapshot(two_members) == before


@pytest.mark.parametrize(
    ("method", "path"),
    [e for e in COLLECTION_ENDPOINTS if e[1] not in SHARED],
    ids=ids([e for e in COLLECTION_ENDPOINTS if e[1] not in SHARED]),
)
def test_b_never_lists_as_rows(two_members: TestClient, method: str, path: str) -> None:
    query = COLLECTION_ROUTES[path]

    def a_rows_in(who: dict[str, str]) -> list[str]:
        response = two_members.request(method, path, params=query, headers=who)
        assert response.status_code == 200, response.text
        return [marker for marker in (*A_IDS, A_DAY) if marker in response.text]

    # Proves the query finds A's rows at all, so B's empty answer means something.
    assert a_rows_in(A)
    assert a_rows_in(B) == []
