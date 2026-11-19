"""Meal Days on real Postgres, as the limited role `api` uses (ADR 0033).

Another User's Days are covered by test_authorization.py's two-Member isolation tests, which
list this route with a `q` that finds Member A's Day.
"""

from typing import Any
from uuid import UUID, uuid7

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session


def catalog_item(client: TestClient, table: str, name: str) -> UUID:
    item = uuid7()
    response = client.put(f"/api/v1/{table}/{item}", json={"name": name, "allow_similar": True})
    assert response.status_code == 201, response.text
    return item


def eat(client: TestClient, day: str, *foods: UUID, at: str = "12:00:00") -> str:
    body = {
        "kind": "foods",
        "occurred_at": f"{day}T{at}Z",
        "occurred_tz": "UTC",
        "food_entries": [{"food_id": str(food), "quantity": 100, "unit": "g"} for food in foods],
    }
    response = client.put(f"/api/v1/meals/{uuid7()}", json=body)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def eat_out(client: TestClient, day: str, *restaurants: UUID) -> str:
    body = {
        "kind": "restaurant",
        "occurred_at": f"{day}T19:00:00Z",
        "occurred_tz": "UTC",
        "restaurant_ids": [str(restaurant) for restaurant in restaurants],
    }
    response = client.put(f"/api/v1/meals/{uuid7()}", json=body)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def page(client: TestClient, **params: Any) -> dict[str, Any]:
    response = client.get("/api/v1/meal-days", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def days(client: TestClient, **params: Any) -> list[str]:
    return [item["day"] for item in page(client, **params)["items"]]


@pytest.fixture
def rice(client: TestClient) -> UUID:
    return catalog_item(client, "foods", "Rice")


def test_a_day_carries_its_meals_as_get_meal_returns_them(client: TestClient, rice: UUID) -> None:
    restaurant = catalog_item(client, "restaurants", "Chipotle")
    breakfast = eat(client, "2026-11-03", rice, at="08:00:00")
    dinner = eat_out(client, "2026-11-03", restaurant)

    items = page(client)["items"]

    assert [item["day"] for item in items] == ["2026-11-03"]
    assert items[0]["meals"] == [
        client.get(f"/api/v1/meals/{meal}").json() for meal in (dinner, breakfast)
    ]


def test_days_are_newest_first_and_skip_days_without_meals(client: TestClient, rice: UUID) -> None:
    for day in ("2026-11-01", "2026-11-04", "2026-11-02"):
        eat(client, day, rice)

    assert days(client) == ["2026-11-04", "2026-11-02", "2026-11-01"]


def test_a_day_stays_whole_across_a_page_boundary(client: TestClient, rice: UUID) -> None:
    busy = [eat(client, "2026-11-03", rice, at=f"{hour:02}:00:00") for hour in range(8, 14)]
    eat(client, "2026-11-02", rice)

    first = page(client, limit=1)
    second = page(client, limit=1, cursor=first["next_cursor"])

    # limit counts Days: six Meals on one Day still make a page of one.
    assert [meal["id"] for meal in first["items"][0]["meals"]] == list(reversed(busy))
    assert [item["day"] for item in second["items"]] == ["2026-11-02"]
    assert second["next_cursor"] is None


def test_cursor_walks_every_day_once(client: TestClient, rice: UUID) -> None:
    logged = [f"2026-11-0{day}" for day in range(1, 6)]
    for day in logged:
        eat(client, day, rice)

    seen: list[str] = []
    cursor = None
    pages = 0
    while True:
        params: dict[str, Any] = {"limit": 2} | ({"cursor": cursor} if cursor else {})
        result = page(client, **params)
        seen += [item["day"] for item in result["items"]]
        pages += 1
        cursor = result["next_cursor"]
        if cursor is None:
            break

    assert seen == list(reversed(logged))
    assert pages == 3


def test_a_full_last_page_has_no_next_cursor(client: TestClient, rice: UUID) -> None:
    eat(client, "2026-11-02", rice)
    eat(client, "2026-11-03", rice)

    assert page(client, limit=2)["next_cursor"] is None


def test_from_and_to_are_inclusive(client: TestClient, rice: UUID) -> None:
    for day in ("2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"):
        eat(client, day, rice)

    assert days(client, **{"from": "2026-11-02", "to": "2026-11-03"}) == [
        "2026-11-03",
        "2026-11-02",
    ]
    assert days(client, **{"from": "2026-11-02", "to": "2026-11-02"}) == ["2026-11-02"]


def test_q_matches_food_and_restaurant_names_ignoring_case(client: TestClient, rice: UUID) -> None:
    breast = catalog_item(client, "foods", "Chicken breast")
    shack = catalog_item(client, "restaurants", "BBQ Chicken Shack")
    other = catalog_item(client, "restaurants", "Taco Stand")
    eat(client, "2026-11-01", breast)
    eat_out(client, "2026-11-02", shack)
    eat_out(client, "2026-11-03", other)
    eat(client, "2026-11-04", rice)

    assert days(client, q="cHiCkEn") == ["2026-11-02", "2026-11-01"]


def test_q_matches_any_restaurant_of_a_meal_not_only_the_first(client: TestClient) -> None:
    """ADR 0034: a food hall is found by any of its stalls."""
    hall = catalog_item(client, "restaurants", "Market Hall")
    stall = catalog_item(client, "restaurants", "Dumpling Stall")
    eat_out(client, "2026-11-03", hall, stall)

    assert days(client, q="dumpling") == ["2026-11-03"]


def test_q_never_finds_another_users_restaurant(
    client: TestClient, session: Session, rice: UUID
) -> None:
    other = session.execute(text("INSERT INTO users DEFAULT VALUES RETURNING id")).scalar_one()
    theirs = session.execute(
        text(
            "INSERT INTO restaurants (user_id, name) VALUES (:user, 'Dumpling Stall') RETURNING id"
        ),
        {"user": other},
    ).scalar_one()
    meal = session.execute(
        text(
            """
            INSERT INTO meals (user_id, kind, restaurant_id, occurred_at, occurred_tz, day)
            VALUES (:user, 'restaurant', :r, '2026-11-03T12:00:00Z', 'UTC', '2026-11-03')
            RETURNING id
            """
        ),
        {"user": other, "r": theirs},
    ).scalar_one()
    session.execute(
        text("INSERT INTO meal_restaurants (user_id, meal_id, restaurant_id) VALUES (:u, :m, :r)"),
        {"u": other, "m": meal, "r": theirs},
    )
    eat(client, "2026-11-03", rice)

    assert days(client, q="dumpling") == []


def test_a_kept_day_shows_its_meals_that_did_not_match(client: TestClient, rice: UUID) -> None:
    salmon = catalog_item(client, "foods", "Salmon")
    eat(client, "2026-11-03", rice, at="08:00:00")
    eat(client, "2026-11-03", salmon, at="19:00:00")

    items = page(client, q="salmon")["items"]

    assert len(items[0]["meals"]) == 2


def test_q_matches_inside_a_name_not_only_its_start(client: TestClient) -> None:
    eat(client, "2026-11-03", catalog_item(client, "foods", "Grilled chicken"))

    assert days(client, q="led chi") == ["2026-11-03"]


def test_q_matches_archived_foods_and_restaurants(client: TestClient, rice: UUID) -> None:
    restaurant = catalog_item(client, "restaurants", "Chipotle")
    eat(client, "2026-11-02", rice)
    eat_out(client, "2026-11-03", restaurant)
    client.patch(f"/api/v1/foods/{rice}", json={"archived": True}).raise_for_status()
    client.patch(f"/api/v1/restaurants/{restaurant}", json={"archived": True}).raise_for_status()

    assert days(client, q="rice") == ["2026-11-02"]
    assert days(client, q="chipotle") == ["2026-11-03"]


@pytest.mark.parametrize(
    ("q", "literal"), [("%", "100% oats"), ("_", "snack_bar"), ("\\", "back\\slash")]
)
def test_like_wildcards_in_q_match_only_themselves(
    client: TestClient, rice: UUID, q: str, literal: str
) -> None:
    eat(client, "2026-11-02", rice)
    eat(client, "2026-11-03", catalog_item(client, "foods", literal))

    assert days(client, q=q) == ["2026-11-03"]


def test_q_collapses_spaces_like_stored_names(client: TestClient) -> None:
    eat(client, "2026-11-03", catalog_item(client, "foods", "Chicken breast"))

    assert days(client, q="  chicken    breast ") == ["2026-11-03"]


def test_blank_q_is_no_filter(client: TestClient, rice: UUID) -> None:
    eat(client, "2026-11-03", rice)

    assert days(client, q="   ") == ["2026-11-03"]


def test_q_pages_by_matching_days(client: TestClient, rice: UUID) -> None:
    salmon = catalog_item(client, "foods", "Salmon")
    for day in ("2026-11-01", "2026-11-03", "2026-11-05"):
        eat(client, day, salmon)
    for day in ("2026-11-02", "2026-11-04"):
        eat(client, day, rice)

    first = page(client, q="salmon", limit=2)
    second = page(client, q="salmon", limit=2, cursor=first["next_cursor"])

    assert [item["day"] for item in first["items"]] == ["2026-11-05", "2026-11-03"]
    assert [item["day"] for item in second["items"]] == ["2026-11-01"]
    assert second["next_cursor"] is None


@pytest.mark.parametrize("cursor", ["junk", "", "!!!", "aGVsbG8="])
def test_bad_cursor_is_invalid(client: TestClient, cursor: str) -> None:
    response = client.get("/api/v1/meal-days", params={"cursor": cursor})

    assert response.status_code == 422, response.text
    assert [error["field"] for error in response.json()["errors"]] == ["query.cursor"]


@pytest.mark.parametrize("limit", [0, 101])
def test_limit_is_bounded(client: TestClient, limit: int) -> None:
    assert client.get("/api/v1/meal-days", params={"limit": limit}).status_code == 422


@pytest.mark.parametrize("q", ["x" * 201, "a\x00b"])
def test_q_is_bounded_like_a_name(client: TestClient, q: str) -> None:
    assert client.get("/api/v1/meal-days", params={"q": q}).status_code == 422
