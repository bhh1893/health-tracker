"""The Meal aggregate on real Postgres, as the limited role `api` uses (ADR 0006)."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4, uuid7

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session

from health_api.problems import KIND_IMMUTABLE, LAST_FOOD_ENTRY, PROBLEM_MEDIA_TYPE


def meal_url(meal: UUID) -> str:
    return f"/api/v1/meals/{meal}"


def catalog_item(client: TestClient, table: str, name: str) -> UUID:
    item = uuid7()
    response = client.put(f"/api/v1/{table}/{item}", json={"name": name, "allow_similar": True})
    assert response.status_code == 201, response.text
    return item


def foods_body(food: UUID, at: str = "2026-11-03T12:00:00+00:00", **fields: Any) -> dict[str, Any]:
    return {
        "kind": "foods",
        "occurred_at": at,
        "occurred_tz": "UTC",
        "food_entries": [{"food_id": str(food), "quantity": 150, "unit": "g"}],
        **fields,
    }


def restaurant_body(restaurant: UUID, **fields: Any) -> dict[str, Any]:
    return {
        "kind": "restaurant",
        "occurred_at": "2026-11-03T12:00:00+00:00",
        "occurred_tz": "UTC",
        "restaurant_id": str(restaurant),
        **fields,
    }


def put(client: TestClient, body: dict[str, Any]) -> dict[str, Any]:
    response = client.put(meal_url(uuid7()), json=body)
    assert response.status_code == 201, response.text
    return response.json()


def list_ids(client: TestClient, **params: Any) -> list[str]:
    response = client.get("/api/v1/meals", params=params)
    assert response.status_code == 200, response.text
    return [meal["id"] for meal in response.json()["items"]]


def error_fields(response: Any) -> list[str]:
    assert response.status_code == 422, response.text
    return [error["field"] for error in response.json()["errors"]]


def food_entry_count(session: Session, meal: str) -> int:
    return session.execute(
        text("SELECT count(*) FROM food_entries WHERE meal_id = :meal"), {"meal": meal}
    ).scalar_one()


@pytest.fixture
def food(client: TestClient) -> UUID:
    return catalog_item(client, "foods", "Rice")


@pytest.fixture
def restaurant(client: TestClient) -> UUID:
    return catalog_item(client, "restaurants", "Chipotle")


@pytest.fixture
def other_user(session: Session) -> UUID:
    return session.execute(text("INSERT INTO users DEFAULT VALUES RETURNING id")).scalar_one()


def test_foods_meal_round_trip(client: TestClient, food: UUID) -> None:
    meal = uuid7()
    body = foods_body(
        food, at="2026-11-03T20:30:00-05:00", label="Dinner", occurred_tz="America/New_York"
    )

    created = client.put(meal_url(meal), json=body)
    read = client.get(meal_url(meal))

    assert created.status_code == 201
    assert read.json() == created.json()
    assert read.json() == {
        "id": str(meal),
        "kind": "foods",
        "label": "Dinner",
        "occurred_at": "2026-11-03T20:30:00-05:00",
        "occurred_tz": "America/New_York",
        "day": "2026-11-03",
        "number": 1,
        "food_entries": [
            {
                "food": {"id": str(food), "name": "Rice", "archived": False},
                "quantity": 150,
                "unit": "g",
            }
        ],
    }


def test_restaurant_meal_round_trip(client: TestClient, restaurant: UUID) -> None:
    meal = put(client, restaurant_body(restaurant))

    assert meal["kind"] == "restaurant"
    assert meal["restaurant"] == {"id": str(restaurant), "name": "Chipotle", "archived": False}
    assert "food_entries" not in meal


def test_day_is_the_date_where_the_user_was(client: TestClient, food: UUID) -> None:
    # The same moment is the 4th in UTC and still the 3rd in New York.
    meal = put(client, foods_body(food, at="2026-11-04T03:00:00Z", occurred_tz="America/New_York"))

    assert meal["day"] == "2026-11-03"
    assert meal["occurred_at"] == "2026-11-03T22:00:00-05:00"


def test_occurred_at_comes_back_in_occurred_tz_whatever_offset_was_sent(
    client: TestClient, food: UUID
) -> None:
    meal = put(client, foods_body(food, at="2026-11-03T12:00:00Z", occurred_tz="Asia/Tokyo"))

    assert meal["occurred_at"] == "2026-11-03T21:00:00+09:00"
    assert meal["day"] == "2026-11-03"


def test_replace_swaps_the_whole_meal(client: TestClient, session: Session, food: UUID) -> None:
    other_food = catalog_item(client, "foods", "Salmon")
    meal = uuid7()
    client.put(meal_url(meal), json=foods_body(food, label="Lunch"))

    replaced = client.put(
        meal_url(meal),
        json={
            "kind": "foods",
            "occurred_at": "2026-11-04T08:00:00+00:00",
            "occurred_tz": "UTC",
            "food_entries": [
                {"food_id": str(other_food), "quantity": 2, "unit": "count"},
                {"food_id": str(food), "quantity": 50, "unit": "g"},
            ],
        },
    )

    assert replaced.status_code == 200
    body = replaced.json()
    assert body["day"] == "2026-11-04"
    assert body["label"] is None, "a PUT that leaves the label out clears it"
    assert [entry["food"]["name"] for entry in body["food_entries"]] == ["Salmon", "Rice"]
    assert food_entry_count(session, str(meal)) == 2


def test_retried_put_is_harmless(client: TestClient, session: Session, food: UUID) -> None:
    meal, body = uuid7(), foods_body(food)

    first = client.put(meal_url(meal), json=body)
    second = client.put(meal_url(meal), json=body)

    assert (first.status_code, second.status_code) == (201, 200)
    assert second.json() == first.json()
    assert food_entry_count(session, str(meal)) == 1


def test_replace_keeps_logged_at(client: TestClient, session: Session, food: UUID) -> None:
    meal = uuid7()
    client.put(meal_url(meal), json=foods_body(food))
    session.execute(
        text("UPDATE meals SET logged_at = '2026-01-01T00:00:00Z' WHERE id = :id"), {"id": meal}
    )

    client.put(meal_url(meal), json=foods_body(food, label="Later"))

    logged_at, updated_at = session.execute(
        text("SELECT logged_at, updated_at FROM meals WHERE id = :id"), {"id": meal}
    ).one()
    assert logged_at == datetime(2026, 1, 1, tzinfo=UTC)
    assert updated_at > logged_at


def test_removing_the_last_food_entry_is_a_conflict(
    client: TestClient, session: Session, food: UUID
) -> None:
    meal = uuid7()
    client.put(meal_url(meal), json=foods_body(food, label="Lunch"))

    response = client.put(meal_url(meal), json=foods_body(food, label="Gone", food_entries=[]))

    assert response.status_code == 409
    assert response.headers["content-type"] == PROBLEM_MEDIA_TYPE
    assert response.json()["type"] == LAST_FOOD_ENTRY
    assert client.get(meal_url(meal)).json()["label"] == "Lunch", "a refused PUT changes nothing"
    assert food_entry_count(session, str(meal)) == 1


def test_creating_a_meal_with_no_food_entries_is_invalid(client: TestClient, food: UUID) -> None:
    meal = uuid7()

    response = client.put(meal_url(meal), json=foods_body(food, food_entries=[]))

    assert error_fields(response) == ["body.food_entries"]
    assert client.get(meal_url(meal)).status_code == 404, "the rolled-back Meal is not there"


def test_kind_is_immutable(client: TestClient, food: UUID, restaurant: UUID) -> None:
    foods_meal, restaurant_meal = uuid7(), uuid7()
    client.put(meal_url(foods_meal), json=foods_body(food))
    client.put(meal_url(restaurant_meal), json=restaurant_body(restaurant))

    to_restaurant = client.put(meal_url(foods_meal), json=restaurant_body(restaurant))
    to_foods = client.put(meal_url(restaurant_meal), json=foods_body(food))

    assert (to_restaurant.status_code, to_foods.status_code) == (409, 409)
    assert to_restaurant.json()["type"] == KIND_IMMUTABLE
    assert to_foods.json()["type"] == KIND_IMMUTABLE
    assert client.get(meal_url(foods_meal)).json()["kind"] == "foods"
    assert client.get(meal_url(restaurant_meal)).json()["kind"] == "restaurant"


def test_meal_cannot_hold_both_food_entries_and_a_restaurant(
    client: TestClient, food: UUID, restaurant: UUID
) -> None:
    body = foods_body(food) | {"restaurant_id": str(restaurant)}

    assert client.put(meal_url(uuid7()), json=body).status_code == 422


def test_another_users_meal_looks_missing(
    client: TestClient, session: Session, food: UUID, other_user: UUID
) -> None:
    meal = uuid7()
    session.execute(
        text(
            """
            INSERT INTO meals (id, user_id, kind, occurred_at, occurred_tz, day, label)
            VALUES (:id, :user, 'foods', '2026-11-03T12:00:00Z', 'UTC', '2026-11-03', 'theirs')
            """
        ),
        {"id": meal, "user": other_user},
    )

    assert client.get(meal_url(meal)).status_code == 404
    assert client.put(meal_url(meal), json=foods_body(food)).status_code == 404
    assert client.delete(meal_url(meal)).status_code == 204
    assert list_ids(client) == []
    label = session.execute(
        text("SELECT label FROM meals WHERE id = :id"), {"id": meal}
    ).scalar_one()
    assert label == "theirs", "neither the PUT nor the DELETE touched it"


def test_another_users_food_is_rejected(
    client: TestClient, session: Session, other_user: UUID
) -> None:
    theirs = session.execute(
        text("INSERT INTO foods (user_id, name) VALUES (:user, 'Rice') RETURNING id"),
        {"user": other_user},
    ).scalar_one()

    response = client.put(meal_url(uuid7()), json=foods_body(theirs))

    assert error_fields(response) == ["body.food_entries"]


def test_another_users_restaurant_is_rejected(
    client: TestClient, session: Session, other_user: UUID
) -> None:
    theirs = session.execute(
        text("INSERT INTO restaurants (user_id, name) VALUES (:user, 'Chipotle') RETURNING id"),
        {"user": other_user},
    ).scalar_one()

    response = client.put(meal_url(uuid7()), json=restaurant_body(theirs))

    assert error_fields(response) == ["body.restaurant_id"]


def test_unknown_food_is_rejected(client: TestClient) -> None:
    response = client.put(meal_url(uuid7()), json=foods_body(uuid7()))

    assert error_fields(response) == ["body.food_entries"]


def test_archived_food_can_stay_on_a_meal(client: TestClient, food: UUID) -> None:
    meal = uuid7()
    client.put(meal_url(meal), json=foods_body(food))
    client.patch(f"/api/v1/foods/{food}", json={"archived": True})

    replaced = client.put(meal_url(meal), json=foods_body(food, label="Edited"))

    assert replaced.status_code == 200
    assert replaced.json()["food_entries"][0]["food"]["archived"] is True


def test_put_requires_a_uuid7(client: TestClient, food: UUID) -> None:
    assert client.put(meal_url(uuid4()), json=foods_body(food)).status_code == 422


@pytest.mark.parametrize(
    ("fields", "field"),
    [
        ({"occurred_at": "2026-11-03T12:00:00"}, "occurred_at"),
        ({"occurred_at": "1762170000"}, "occurred_at"),
        ({"occurred_at": 1762170000}, "occurred_at"),
        ({"occurred_at": "2026-02-30T12:00:00Z"}, "occurred_at"),
        ({"occurred_tz": "Mars/Olympus"}, "occurred_tz"),
        ({"occurred_tz": "../etc/passwd"}, "occurred_tz"),
        ({"label": "   "}, "label"),
        ({"label": "x" * 201}, "label"),
        ({"label": "a\x00b"}, "label"),
        ({"food_entries": [{"food_id": "x", "quantity": 1, "unit": "g"}]}, "food_id"),
        ({"food_entries": [{"food_id": str(uuid7()), "quantity": 0, "unit": "g"}]}, "quantity"),
        ({"food_entries": [{"food_id": str(uuid7()), "quantity": 1, "unit": "oz"}]}, "unit"),
    ],
)
def test_invalid_fields_are_rejected(
    client: TestClient, food: UUID, fields: dict[str, Any], field: str
) -> None:
    response = client.put(meal_url(uuid7()), json=foods_body(food) | fields)

    assert any(field in name for name in error_fields(response))


def test_occurred_at_may_be_only_slightly_in_the_future(client: TestClient, food: UUID) -> None:
    now = datetime.now(UTC)
    soon = (now + timedelta(minutes=4)).isoformat()
    later = (now + timedelta(minutes=6)).isoformat()

    assert client.put(meal_url(uuid7()), json=foods_body(food, at=soon)).status_code == 201
    assert client.put(meal_url(uuid7()), json=foods_body(food, at=later)).status_code == 422


def test_occurred_at_has_no_past_bound(client: TestClient, food: UUID) -> None:
    meal = put(client, foods_body(food, at="1999-12-31T23:59:59Z"))

    assert meal["day"] == "1999-12-31"


@pytest.mark.parametrize("at", ["0001-01-01T00:00:00+14:00", "9999-12-31T23:59:59-14:00"])
def test_extreme_timestamps_are_invalid_not_a_crash(
    client: TestClient, food: UUID, at: str
) -> None:
    assert client.put(meal_url(uuid7()), json=foods_body(food, at=at)).status_code == 422


def test_numbers_follow_occurred_at_within_a_day(client: TestClient, food: UUID) -> None:
    dinner = put(client, foods_body(food, at="2026-11-03T19:00:00Z"))
    breakfast = put(client, foods_body(food, at="2026-11-03T08:00:00Z"))
    next_day = put(client, foods_body(food, at="2026-11-04T08:00:00Z"))

    assert client.get(meal_url(UUID(breakfast["id"]))).json()["number"] == 1
    assert client.get(meal_url(UUID(dinner["id"]))).json()["number"] == 2
    assert client.get(meal_url(UUID(next_day["id"]))).json()["number"] == 1


def test_numbers_close_up_after_a_delete(client: TestClient, food: UUID) -> None:
    first = put(client, foods_body(food, at="2026-11-03T08:00:00Z"))
    second = put(client, foods_body(food, at="2026-11-03T12:00:00Z"))

    client.delete(meal_url(UUID(first["id"])))

    assert client.get(meal_url(UUID(second["id"]))).json()["number"] == 1


def test_a_food_filter_keeps_the_real_numbers(client: TestClient, food: UUID) -> None:
    other_food = catalog_item(client, "foods", "Salmon")
    put(client, foods_body(other_food, at="2026-11-03T08:00:00Z"))
    put(client, foods_body(food, at="2026-11-03T12:00:00Z"))

    meals = client.get("/api/v1/meals", params={"food_id": str(food)}).json()["items"]

    assert [meal["number"] for meal in meals] == [2]


def test_list_filters_by_inclusive_day_range(client: TestClient, food: UUID) -> None:
    ids = {
        day: put(client, foods_body(food, at=f"{day}T12:00:00Z"))["id"]
        for day in ("2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04")
    }

    in_range = list_ids(client, **{"from": "2026-11-02", "to": "2026-11-03"})
    one_day = list_ids(client, **{"from": "2026-11-02", "to": "2026-11-02"})

    assert in_range == [ids["2026-11-03"], ids["2026-11-02"]]
    assert one_day == [ids["2026-11-02"]]


def test_list_is_newest_first_by_day_even_across_timezones(client: TestClient, food: UUID) -> None:
    # Later as moments, but on an earlier Day, because the user was further west.
    west = foods_body(food, at="2026-11-04T05:00:00Z", occurred_tz="Pacific/Honolulu")
    first_west = put(client, west)
    second_west = put(client, west | {"occurred_at": "2026-11-04T06:00:00Z"})
    later_day = put(client, foods_body(food, at="2026-11-04T01:00:00Z"))

    assert first_west["day"] == "2026-11-03"
    assert list_ids(client) == [later_day["id"], second_west["id"], first_west["id"]]
    # A page fetches limit + 1 rows, so this cuts the list after two of the three.
    assert list_ids(client, limit=1) == [later_day["id"]], "the page is cut in the same order"


def test_list_embeds_both_kinds(client: TestClient, food: UUID, restaurant: UUID) -> None:
    put(client, foods_body(food, at="2026-11-03T08:00:00Z"))
    put(client, restaurant_body(restaurant))

    meals = client.get("/api/v1/meals").json()["items"]

    assert [meal["kind"] for meal in meals] == ["restaurant", "foods"]
    assert meals[0]["restaurant"]["name"] == "Chipotle"
    assert meals[1]["food_entries"][0]["food"]["name"] == "Rice"


def test_cursor_walks_every_meal_once(client: TestClient, food: UUID) -> None:
    # Two share a moment, so only the id can order them: the keyset's tie-break.
    moments = ["08:00:00", "12:00:00", "12:00:00", "19:00:00", "21:00:00"]
    created = [put(client, foods_body(food, at=f"2026-11-03T{at}Z"))["id"] for at in moments]

    seen: list[str] = []
    cursor = None
    pages = 0
    while True:
        params: dict[str, Any] = {"limit": 2} | ({"cursor": cursor} if cursor else {})
        page = client.get("/api/v1/meals", params=params).json()
        seen += [meal["id"] for meal in page["items"]]
        pages += 1
        cursor = page["next_cursor"]
        if cursor is None:
            break

    assert seen == list(reversed(created))
    assert pages == 3


def test_a_full_last_page_has_no_next_cursor(client: TestClient, food: UUID) -> None:
    put(client, foods_body(food))
    put(client, foods_body(food))

    assert client.get("/api/v1/meals", params={"limit": 2}).json()["next_cursor"] is None


def test_cursor_is_stable_when_a_meal_is_added_behind_it(client: TestClient, food: UUID) -> None:
    put(client, foods_body(food, at="2026-11-03T08:00:00Z"))
    newest = put(client, foods_body(food, at="2026-11-03T12:00:00Z"))
    older = client.get("/api/v1/meals", params={"limit": 1}).json()
    assert older["items"][0]["id"] == newest["id"]

    put(client, foods_body(food, at="2026-11-03T20:00:00Z"))
    rest = client.get("/api/v1/meals", params={"cursor": older["next_cursor"]}).json()

    assert newest["id"] not in [meal["id"] for meal in rest["items"]]
    assert len(rest["items"]) == 1


@pytest.mark.parametrize("cursor", ["junk", "", "!!!", "aGVsbG8=", "YXxifGM="])
def test_bad_cursor_is_invalid(client: TestClient, cursor: str) -> None:
    response = client.get("/api/v1/meals", params={"cursor": cursor})

    assert error_fields(response) == ["query.cursor"]


@pytest.mark.parametrize("limit", [0, 201])
def test_limit_is_bounded(client: TestClient, limit: int) -> None:
    assert client.get("/api/v1/meals", params={"limit": limit}).status_code == 422


def test_delete_cascades_and_a_retry_is_harmless(
    client: TestClient, session: Session, food: UUID
) -> None:
    meal = uuid7()
    client.put(meal_url(meal), json=foods_body(food))

    first = client.delete(meal_url(meal))
    second = client.delete(meal_url(meal))

    assert (first.status_code, second.status_code) == (204, 204)
    assert client.get(meal_url(meal)).status_code == 404
    assert food_entry_count(session, str(meal)) == 0


def test_writes_commit(committing_client: TestClient) -> None:
    food = catalog_item(committing_client, "foods", "Rice")
    meal = uuid7()

    created = committing_client.put(meal_url(meal), json=foods_body(food))
    read = committing_client.get(meal_url(meal))

    assert created.status_code == 201
    assert read.status_code == 200
    assert read.json()["food_entries"][0]["food"]["id"] == str(food)

    assert committing_client.delete(meal_url(meal)).status_code == 204
    assert committing_client.get(meal_url(meal)).status_code == 404


def test_a_failed_replace_leaves_the_old_meal_whole(
    committing_client: TestClient, api_rw_engine: Engine
) -> None:
    """The transactional boundary: the entries are deleted, then the insert fails."""
    food = catalog_item(committing_client, "foods", "Rice")
    meal = uuid7()
    committing_client.put(meal_url(meal), json=foods_body(food, label="Lunch"))

    response = committing_client.put(meal_url(meal), json=foods_body(uuid7(), label="Broken"))

    assert response.status_code == 422
    read = committing_client.get(meal_url(meal)).json()
    assert read["label"] == "Lunch"
    assert [entry["food"]["id"] for entry in read["food_entries"]] == [str(food)]
    with api_rw_engine.connect() as connection:
        count = connection.execute(
            text("SELECT count(*) FROM food_entries WHERE meal_id = :id"), {"id": meal}
        ).scalar_one()
    assert count == 1


def test_concurrent_replaces_do_not_mix_their_food_entries(
    committing_client: TestClient,
) -> None:
    """Without the row lock, two replaces both delete, then both insert: a Meal of both."""
    food = catalog_item(committing_client, "foods", "Rice")
    meal = uuid7()
    committing_client.put(meal_url(meal), json=foods_body(food))

    def replace_with(count: int) -> int:
        entries = [{"food_id": str(food), "quantity": count, "unit": "g"}] * count
        return committing_client.put(
            meal_url(meal), json=foods_body(food, food_entries=entries)
        ).status_code

    counts = [1, 2, 3, 4, 5, 6, 7, 8] * 3
    with ThreadPoolExecutor(max_workers=8) as pool:
        statuses = list(pool.map(replace_with, counts))

    assert set(statuses) == {200}
    entries = committing_client.get(meal_url(meal)).json()["food_entries"]
    assert len(entries) == entries[0]["quantity"], "every entry came from one single PUT"


def test_day_query_params_are_dates(client: TestClient) -> None:
    assert client.get("/api/v1/meals", params={"from": "not-a-day"}).status_code == 422
