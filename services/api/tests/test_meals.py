"""The Meal aggregate on real Postgres, as the limited role `api` uses (ADR 0006)."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4, uuid7

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session

from health_api.entries import MAX_AMOUNT
from health_api.meals import MAX_RESTAURANTS
from health_api.problems import (
    KIND_IMMUTABLE,
    LAST_FOOD_ENTRY,
    PROBLEM_MEDIA_TYPE,
    SEVERAL_RESTAURANTS,
)


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
    """The deprecated one-Restaurant shape, as clients from before ADR 0034 send it."""
    return {
        "kind": "restaurant",
        "occurred_at": "2026-11-03T12:00:00+00:00",
        "occurred_tz": "UTC",
        "restaurant_id": str(restaurant),
        **fields,
    }


def restaurants_body(*restaurants: UUID, **fields: Any) -> dict[str, Any]:
    return {
        "kind": "restaurant",
        "occurred_at": "2026-11-03T12:00:00+00:00",
        "occurred_tz": "UTC",
        "restaurant_ids": [str(restaurant) for restaurant in restaurants],
        **fields,
    }


def restaurant_ids(meal: dict[str, Any]) -> list[str]:
    return [restaurant["id"] for restaurant in meal["restaurants"]]


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
        "total": {"kcal": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0, "incomplete": True},
    }


def test_restaurant_meal_round_trip(client: TestClient, restaurant: UUID) -> None:
    meal = put(client, restaurant_body(restaurant))

    chipotle = {"id": str(restaurant), "name": "Chipotle", "archived": False}
    assert meal["kind"] == "restaurant"
    assert meal["restaurants"] == [chipotle]
    assert meal["restaurant"] == chipotle
    assert "food_entries" not in meal
    # Its Day counts as the User's flat value (ADR 0023), which no single Meal owns.
    assert "total" not in meal


# Several Restaurants (ADR 0034)


@pytest.fixture
def three_restaurants(client: TestClient) -> list[UUID]:
    # Created C, B, A, so neither creation order nor name order is the order sent below.
    return [catalog_item(client, "restaurants", name) for name in ("Cafe", "Bar", "Arepas")][::-1]


def test_restaurants_read_back_in_the_order_sent(
    client: TestClient, three_restaurants: list[UUID]
) -> None:
    meal = uuid7()
    first, second, third = three_restaurants

    created = client.put(meal_url(meal), json=restaurants_body(first, second, third)).json()
    replaced = client.put(meal_url(meal), json=restaurants_body(third, first, second)).json()

    assert restaurant_ids(created) == [str(first), str(second), str(third)]
    assert restaurant_ids(replaced) == [str(third), str(first), str(second)]
    assert client.get(meal_url(meal)).json() == replaced
    assert replaced["restaurant"]["id"] == str(third), "the deprecated field is the first"


def test_food_entries_read_back_in_the_order_sent(client: TestClient) -> None:
    foods = [catalog_item(client, "foods", name) for name in ("Cafe au lait", "Bagel", "Apple")]
    entries = [{"food_id": str(food), "quantity": 100, "unit": "g"} for food in foods[::-1]]

    meal = put(client, foods_body(foods[0], food_entries=entries))

    assert [entry["food"]["id"] for entry in meal["food_entries"]] == [
        str(food) for food in foods[::-1]
    ]


def test_the_first_restaurant_is_also_written_to_the_old_column(
    client: TestClient, session: Session, three_restaurants: list[UUID]
) -> None:
    """What an api pod from before ADR 0034 reads mid-rollout."""
    meal = put(client, restaurants_body(*three_restaurants[1:]))

    column = session.scalar(
        text("SELECT restaurant_id FROM meals WHERE id = :id"), {"id": meal["id"]}
    )
    assert column == three_restaurants[1]


def test_a_meal_saved_by_the_old_api_mid_rollout_still_reads(
    client: TestClient, session: Session, restaurant: UUID
) -> None:
    """An api pod from before ADR 0034 writes only meals.restaurant_id, no meal_restaurants."""
    meal = session.execute(
        text(
            """
            INSERT INTO meals (user_id, kind, restaurant_id, occurred_at, occurred_tz, day)
            SELECT user_id, 'restaurant', id, '2026-11-03T12:00:00Z', 'UTC', '2026-11-03'
            FROM restaurants WHERE id = :restaurant
            RETURNING id
            """
        ),
        {"restaurant": restaurant},
    ).scalar_one()

    read = client.get(meal_url(meal))

    assert read.status_code == 200, read.text
    assert restaurant_ids(read.json()) == [str(restaurant)]
    assert list_ids(client) == [str(meal)]


@pytest.mark.parametrize("count", [0, MAX_RESTAURANTS + 1])
def test_restaurant_count_is_bounded(client: TestClient, count: int) -> None:
    restaurants = [uuid7() for _ in range(count)]

    response = client.put(meal_url(uuid7()), json=restaurants_body(*restaurants))

    assert error_fields(response) == ["body.restaurant.restaurant_ids"]


def test_ten_restaurants_fit(client: TestClient) -> None:
    restaurants = [catalog_item(client, "restaurants", f"Stop {n}") for n in range(10)]

    assert len(put(client, restaurants_body(*restaurants))["restaurants"]) == MAX_RESTAURANTS


def test_a_restaurant_listed_twice_is_invalid(client: TestClient, restaurant: UUID) -> None:
    response = client.put(meal_url(uuid7()), json=restaurants_body(restaurant, restaurant))

    assert response.status_code == 422, response.text


@pytest.mark.parametrize("both", [True, False])
def test_send_exactly_one_restaurant_field(
    client: TestClient, restaurant: UUID, both: bool
) -> None:
    body = restaurants_body(restaurant) | (
        {"restaurant_id": str(restaurant)} if both else {"restaurant_ids": None}
    )

    assert client.put(meal_url(uuid7()), json=body).status_code == 422


def test_the_old_field_cannot_shrink_a_meal_of_several(
    client: TestClient, three_restaurants: list[UUID]
) -> None:
    meal = uuid7()
    client.put(meal_url(meal), json=restaurants_body(*three_restaurants, label="Food hall"))

    response = client.put(meal_url(meal), json=restaurant_body(three_restaurants[0]))

    assert response.status_code == 409
    assert response.json()["type"] == SEVERAL_RESTAURANTS
    read = client.get(meal_url(meal)).json()
    assert read["label"] == "Food hall", "a refused PUT changes nothing"
    assert restaurant_ids(read) == [str(r) for r in three_restaurants]


def test_the_old_field_still_replaces_a_meal_of_one(
    client: TestClient, three_restaurants: list[UUID]
) -> None:
    meal = uuid7()
    first, second, _ = three_restaurants
    client.put(meal_url(meal), json=restaurants_body(first))

    response = client.put(meal_url(meal), json=restaurant_body(second))

    assert response.status_code == 200, response.text
    assert restaurant_ids(response.json()) == [str(second)]


def test_another_users_restaurant_in_the_list_is_rejected(
    client: TestClient, session: Session, restaurant: UUID, other_user: UUID
) -> None:
    """Second in the list: only the join table's FK sees it, not meals.restaurant_id's."""
    theirs = session.execute(
        text("INSERT INTO restaurants (user_id, name) VALUES (:user, 'Bar') RETURNING id"),
        {"user": other_user},
    ).scalar_one()
    meal = uuid7()

    response = client.put(meal_url(meal), json=restaurants_body(restaurant, theirs))

    assert error_fields(response) == ["body.restaurant_ids"]
    assert client.get(meal_url(meal)).status_code == 404


def test_another_users_restaurant_first_in_the_list_is_rejected_on_the_list(
    client: TestClient, session: Session, restaurant: UUID, other_user: UUID
) -> None:
    """First in the list, meals.restaurant_id's FK refuses it: still the field that was sent."""
    theirs = session.execute(
        text("INSERT INTO restaurants (user_id, name) VALUES (:user, 'Bar') RETURNING id"),
        {"user": other_user},
    ).scalar_one()

    response = client.put(meal_url(uuid7()), json=restaurants_body(theirs, restaurant))

    assert error_fields(response) == ["body.restaurant_ids"]


def test_another_users_meal_of_several_restaurants_is_untouched(
    client: TestClient, session: Session, restaurant: UUID, other_user: UUID
) -> None:
    theirs = [
        session.execute(
            text("INSERT INTO restaurants (user_id, name) VALUES (:user, :name) RETURNING id"),
            {"user": other_user, "name": name},
        ).scalar_one()
        for name in ("Bar", "Cafe")
    ]
    meal = session.execute(
        text(
            """
            INSERT INTO meals (user_id, kind, restaurant_id, occurred_at, occurred_tz, day)
            VALUES (:user, 'restaurant', :first, '2026-11-03T12:00:00Z', 'UTC', '2026-11-03')
            RETURNING id
            """
        ),
        {"user": other_user, "first": theirs[0]},
    ).scalar_one()
    session.execute(
        text(
            """
            INSERT INTO meal_restaurants (user_id, meal_id, restaurant_id)
            VALUES (:user, :meal, :restaurant)
            """
        ),
        [{"user": other_user, "meal": meal, "restaurant": r} for r in theirs],
    )

    assert client.get(meal_url(meal)).status_code == 404
    assert client.put(meal_url(meal), json=restaurants_body(restaurant)).status_code == 404
    assert client.put(meal_url(meal), json=restaurant_body(restaurant)).status_code == 404
    held = session.scalar(
        text("SELECT count(*) FROM meal_restaurants WHERE meal_id = :id"), {"id": meal}
    )
    assert held == 2


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


@pytest.mark.parametrize("label", ["", "   ", None])
def test_a_blank_label_is_no_label(client: TestClient, food: UUID, label: str | None) -> None:
    assert put(client, foods_body(food, label=label))["label"] is None


def test_a_label_is_normalized(client: TestClient, food: UUID) -> None:
    assert put(client, foods_body(food, label="  Late   lunch "))["label"] == "Late lunch"


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
    # Two share a moment across the limit=2 page boundary, so only the id can order them.
    moments = ["08:00:00", "09:00:00", "12:00:00", "12:00:00", "21:00:00"]
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


def test_deleting_a_restaurant_meal_deletes_its_restaurant_rows(
    client: TestClient, session: Session, three_restaurants: list[UUID]
) -> None:
    meal = put(client, restaurants_body(*three_restaurants))

    client.delete(meal_url(UUID(meal["id"])))

    assert session.scalar(text("SELECT count(*) FROM meal_restaurants")) == 0


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


@pytest.mark.parametrize("day", ["0", "1700000000", "2026-1-1", "2026-11-03T00:00:00"])
def test_range_days_must_be_iso_dates(client: TestClient, day: str) -> None:
    response = client.get("/api/v1/meals", params={"to": day})

    assert error_fields(response) == ["query.to"]


@pytest.mark.parametrize("quantity", ["1.5", MAX_AMOUNT + 1, 1.7976931348623157e308])
def test_quantity_must_be_a_number_in_range(
    client: TestClient, food: UUID, quantity: float | str
) -> None:
    entry = {"food_id": str(food), "quantity": quantity, "unit": "g"}

    response = client.put(meal_url(uuid7()), json=foods_body(food, food_entries=[entry]))

    assert response.status_code == 422, response.text


def test_the_largest_quantity_reads_back_unchanged(client: TestClient, food: UUID) -> None:
    entry = {"food_id": str(food), "quantity": MAX_AMOUNT, "unit": "g"}

    meal = put(client, foods_body(food, food_entries=[entry]))

    assert meal["food_entries"][0]["quantity"] == MAX_AMOUNT


# A Meal's total: the same rules as a Day Total (ADR 0023), for one Meal.

RICE = {"basis_g": 100, "kcal": 130, "protein_g": 2.7, "carbs_g": 28.2, "fat_g": 0.3}
EGG = {"basis_g": 100, "kcal": 140, "protein_g": 12, "carbs_g": 1, "fat_g": 10}


def food_with(client: TestClient, name: str, **fields: Any) -> UUID:
    item = catalog_item(client, "foods", name)
    client.patch(f"/api/v1/foods/{item}", json=fields).raise_for_status()
    return item


def entries_body(*entries: tuple[UUID, float, str], at: str = "2026-11-03T12:00:00+00:00") -> Any:
    return {
        "kind": "foods",
        "occurred_at": at,
        "occurred_tz": "UTC",
        "food_entries": [
            {"food_id": str(food), "quantity": quantity, "unit": unit}
            for food, quantity, unit in entries
        ],
    }


def test_a_meal_totals_its_food_entries(client: TestClient) -> None:
    rice = food_with(client, "Rice", nutrition=RICE)
    egg = food_with(client, "Egg", nutrition=EGG, piece_g=50)

    meal = put(client, entries_body((rice, 250, "g"), (egg, 2, "count")))

    assert meal["total"] == {
        "kcal": pytest.approx(325 + 140),
        "protein_g": pytest.approx(6.75 + 12),
        "carbs_g": pytest.approx(70.5 + 1),
        "fat_g": pytest.approx(0.75 + 10),
        "incomplete": False,
    }


def test_a_meal_total_leaves_out_what_it_cannot_count(client: TestClient) -> None:
    rice = food_with(client, "Rice", nutrition=RICE)
    egg = food_with(client, "Egg", nutrition=EGG)
    stew = catalog_item(client, "foods", "Mystery stew")

    meal = put(client, entries_body((rice, 100, "g"), (egg, 2, "count"), (stew, 300, "g")))

    assert meal["total"] == {
        "kcal": pytest.approx(130),
        "protein_g": pytest.approx(2.7),
        "carbs_g": pytest.approx(28.2),
        "fat_g": pytest.approx(0.3),
        "incomplete": True,
    }


def test_meal_totals_in_a_list_belong_to_their_own_meal(client: TestClient) -> None:
    rice = food_with(client, "Rice", nutrition=RICE)
    stew = catalog_item(client, "foods", "Mystery stew")
    put(client, entries_body((rice, 100, "g"), at="2026-11-03T08:00:00+00:00"))
    put(client, entries_body((stew, 100, "g"), at="2026-11-03T12:00:00+00:00"))
    put(client, entries_body((rice, 200, "g"), at="2026-11-03T18:00:00+00:00"))

    listed = client.get("/api/v1/meals").json()["items"]

    assert [(meal["total"]["kcal"], meal["total"]["incomplete"]) for meal in listed] == [
        (260, False),
        (0, True),
        (130, False),
    ]


def test_the_meals_of_a_day_add_up_to_its_day_total(client: TestClient) -> None:
    """Both read the same SQL for an Entry's share, so they cannot drift apart."""
    rice = food_with(client, "Rice", nutrition=RICE)
    egg = food_with(client, "Egg", nutrition=EGG, piece_g=50)
    put(client, entries_body((rice, 180, "g"), at="2026-11-03T08:00:00+00:00"))
    put(client, entries_body((egg, 3, "count"), (rice, 75, "g"), at="2026-11-03T18:00:00+00:00"))

    meals = client.get("/api/v1/meals").json()["items"]
    [day] = client.get("/api/v1/days", params={"from": "2026-11-03", "to": "2026-11-03"}).json()

    for value in ("kcal", "protein_g", "carbs_g", "fat_g"):
        assert sum(meal["total"][value] for meal in meals) == pytest.approx(day[value])


def test_correcting_a_food_corrects_a_meal_total(client: TestClient) -> None:
    rice = catalog_item(client, "foods", "Rice")
    meal = put(client, entries_body((rice, 100, "g")))
    assert meal["total"]["incomplete"] is True

    client.patch(f"/api/v1/foods/{rice}", json={"nutrition": RICE}).raise_for_status()

    total = client.get(meal_url(UUID(meal["id"]))).json()["total"]
    assert (total["kcal"], total["incomplete"]) == (130, False)
