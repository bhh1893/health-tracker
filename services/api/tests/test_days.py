"""Day Totals on real Postgres, as the limited role `api` uses (ADR 0023)."""

from typing import Any
from uuid import UUID, uuid7

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

DAY = "2026-11-03"
# Per 100 g, so a quantity in grams reads straight off as a percentage.
RICE = {"basis_g": 100, "kcal": 130, "protein_g": 2.7, "carbs_g": 28.2, "fat_g": 0.3}
# Per 40 g serving: a Basis other than 100.
OATS = {"basis_g": 40, "kcal": 150, "protein_g": 5, "carbs_g": 27, "fat_g": 3}
EGG = {"basis_g": 100, "kcal": 140, "protein_g": 12, "carbs_g": 1, "fat_g": 10}


def new_food(client: TestClient, name: str, **fields: Any) -> UUID:
    food = uuid7()
    body = {"name": name, "allow_similar": True, **fields}
    client.put(f"/api/v1/foods/{food}", json=body).raise_for_status()
    return food


def eat(client: TestClient, *entries: tuple[UUID, float, str], day: str = DAY) -> UUID:
    meal = uuid7()
    body = {
        "kind": "foods",
        "occurred_at": f"{day}T12:00:00+00:00",
        "occurred_tz": "UTC",
        "food_entries": [
            {"food_id": str(food), "quantity": quantity, "unit": unit}
            for food, quantity, unit in entries
        ],
    }
    client.put(f"/api/v1/meals/{meal}", json=body).raise_for_status()
    return meal


def eat_out(client: TestClient, day: str = DAY) -> None:
    restaurant = uuid7()
    client.put(
        f"/api/v1/restaurants/{restaurant}", json={"name": f"Cafe {restaurant}"}
    ).raise_for_status()
    body = {
        "kind": "restaurant",
        "occurred_at": f"{day}T19:00:00+00:00",
        "occurred_tz": "UTC",
        "restaurant_id": str(restaurant),
    }
    client.put(f"/api/v1/meals/{uuid7()}", json=body).raise_for_status()


def days(client: TestClient, from_day: str = DAY, to_day: str = DAY) -> list[dict[str, Any]]:
    response = client.get("/api/v1/days", params={"from": from_day, "to": to_day})
    assert response.status_code == 200, response.text
    return response.json()


def total(
    kcal: float,
    protein_g: float | None,
    carbs_g: float | None,
    fat_g: float | None,
    day: str = DAY,
    **flags: bool,
) -> dict[str, Any]:
    return {
        "day": day,
        "kcal": pytest.approx(kcal),
        "protein_g": protein_g if protein_g is None else pytest.approx(protein_g),
        "carbs_g": carbs_g if carbs_g is None else pytest.approx(carbs_g),
        "fat_g": fat_g if fat_g is None else pytest.approx(fat_g),
        "restaurant_day": False,
        "incomplete": False,
        **flags,
    }


def test_grams_scale_from_the_basis(client: TestClient) -> None:
    rice = new_food(client, "Rice", nutrition=RICE)
    eat(client, (rice, 250, "g"))

    assert days(client) == [total(325, 6.75, 70.5, 0.75)]


def test_a_basis_other_than_100(client: TestClient) -> None:
    """A label read as "per 40 g serving: 150 kcal": 80 g is two servings."""
    oats = new_food(client, "Oats", nutrition=OATS)
    eat(client, (oats, 80, "g"))

    assert days(client) == [total(300, 10, 54, 6)]


def test_a_count_goes_through_piece_weight(client: TestClient) -> None:
    egg = new_food(client, "Egg", nutrition=EGG, piece_g=50)
    eat(client, (egg, 3, "count"))

    assert days(client) == [total(210, 18, 1.5, 15)]


def test_a_day_sums_every_meal_and_entry(client: TestClient) -> None:
    rice = new_food(client, "Rice", nutrition=RICE)
    egg = new_food(client, "Egg", nutrition=EGG, piece_g=50)
    eat(client, (rice, 100, "g"), (egg, 2, "count"))
    eat(client, (rice, 200, "g"), (rice, 50, "g"))

    assert days(client) == [total(130 * 3.5 + 140, 2.7 * 3.5 + 12, 28.2 * 3.5 + 1, 0.3 * 3.5 + 10)]


def test_a_food_without_nutrition_makes_the_day_incomplete(client: TestClient) -> None:
    """The total still sums what is known: it under-reports, and says so."""
    rice = new_food(client, "Rice", nutrition=RICE)
    mystery = new_food(client, "Mystery stew")
    eat(client, (rice, 100, "g"), (mystery, 300, "g"))

    assert days(client) == [total(130, 2.7, 28.2, 0.3, incomplete=True)]


def test_a_count_without_piece_weight_makes_the_day_incomplete(client: TestClient) -> None:
    egg = new_food(client, "Egg", nutrition=EGG)
    eat(client, (egg, 3, "count"))

    assert days(client) == [total(0, 0, 0, 0, incomplete=True)]


def test_grams_do_not_need_piece_weight(client: TestClient) -> None:
    egg = new_food(client, "Egg", nutrition=EGG)
    eat(client, (egg, 50, "g"))

    assert days(client) == [total(70, 6, 0.5, 5)]


def test_piece_weight_alone_is_not_nutrition(client: TestClient) -> None:
    egg = new_food(client, "Egg", piece_g=50)
    eat(client, (egg, 3, "count"))

    assert days(client) == [total(0, 0, 0, 0, incomplete=True)]


def test_a_restaurant_day_is_the_flat_value_with_unknown_macros(client: TestClient) -> None:
    eat_out(client)

    assert days(client) == [total(5000, None, None, None, restaurant_day=True)]


def test_a_restaurant_day_ignores_its_food_meals(client: TestClient) -> None:
    """Whatever else was logged: not 5000 plus the rice, and never incomplete."""
    rice = new_food(client, "Rice", nutrition=RICE)
    mystery = new_food(client, "Mystery stew")
    eat(client, (rice, 250, "g"), (mystery, 300, "g"))
    eat_out(client)

    assert days(client) == [total(5000, None, None, None, restaurant_day=True)]


def test_a_changed_restaurant_day_value_changes_past_days(client: TestClient) -> None:
    eat_out(client)
    assert days(client)[0]["kcal"] == 5000

    client.patch("/api/me", json={"restaurant_day_kcal": 3500}).raise_for_status()

    assert days(client) == [total(3500, None, None, None, restaurant_day=True)]


def test_correcting_a_food_corrects_past_days(client: TestClient) -> None:
    """Computed, not snapshotted: the total follows the Food's current Nutrition."""
    rice = new_food(client, "Rice", nutrition={**RICE, "kcal": 13})
    eat(client, (rice, 100, "g"))
    assert days(client)[0]["kcal"] == 13

    client.patch(f"/api/v1/foods/{rice}", json={"nutrition": RICE}).raise_for_status()

    assert days(client)[0]["kcal"] == 130


def test_filling_in_nutrition_completes_the_day(client: TestClient) -> None:
    rice = new_food(client, "Rice")
    eat(client, (rice, 100, "g"))
    assert days(client)[0]["incomplete"] is True

    client.patch(f"/api/v1/foods/{rice}", json={"nutrition": RICE}).raise_for_status()

    assert days(client) == [total(130, 2.7, 28.2, 0.3)]


def test_an_archived_food_still_counts(client: TestClient) -> None:
    rice = new_food(client, "Rice", nutrition=RICE)
    eat(client, (rice, 100, "g"))

    client.patch(f"/api/v1/foods/{rice}", json={"archived": True}).raise_for_status()

    assert days(client) == [total(130, 2.7, 28.2, 0.3)]


def test_one_row_per_day_newest_first_and_days_without_meals_are_left_out(
    client: TestClient,
) -> None:
    rice = new_food(client, "Rice", nutrition=RICE)
    eat(client, (rice, 100, "g"), day="2026-11-01")
    eat(client, (rice, 200, "g"), day="2026-11-04")
    eat_out(client, day="2026-11-02")

    listed = days(client, "2026-11-01", "2026-11-05")

    assert [(row["day"], row["kcal"]) for row in listed] == [
        ("2026-11-04", 260),
        ("2026-11-02", 5000),
        ("2026-11-01", 130),
    ]


def test_the_range_includes_both_ends(client: TestClient) -> None:
    rice = new_food(client, "Rice", nutrition=RICE)
    for day in ("2026-10-31", "2026-11-01", "2026-11-03", "2026-11-04"):
        eat(client, (rice, 100, "g"), day=day)

    listed = days(client, "2026-11-01", "2026-11-03")

    assert [row["day"] for row in listed] == ["2026-11-03", "2026-11-01"]


def test_no_meals_is_an_empty_list(client: TestClient) -> None:
    assert days(client) == []


def test_another_users_meals_are_not_counted(client: TestClient, session: Session) -> None:
    rice = new_food(client, "Rice", nutrition=RICE)
    eat(client, (rice, 100, "g"))
    other = session.execute(text("INSERT INTO users DEFAULT VALUES RETURNING id")).scalar_one()
    theirs = session.execute(
        text(
            "INSERT INTO foods (user_id, name, basis_g, kcal, protein_g, carbs_g, fat_g) "
            "VALUES (:user, 'Theirs', 100, 900, 1, 1, 1) RETURNING id"
        ),
        {"user": other},
    ).scalar_one()
    meal = session.execute(
        text(
            "INSERT INTO meals (user_id, kind, occurred_at, occurred_tz, day) "
            "VALUES (:user, 'foods', :at, 'UTC', :day) RETURNING id"
        ),
        {"user": other, "at": f"{DAY}T12:00:00+00:00", "day": DAY},
    ).scalar_one()
    session.execute(
        text(
            "INSERT INTO food_entries (user_id, meal_id, food_id, quantity, unit) "
            "VALUES (:user, :meal, :food, 100, 'g')"
        ),
        {"user": other, "meal": meal, "food": theirs},
    )

    assert days(client) == [total(130, 2.7, 28.2, 0.3)]


def test_a_range_of_366_days_is_allowed(client: TestClient) -> None:
    assert days(client, "2024-01-01", "2025-01-01") == []


@pytest.mark.parametrize(
    ("params", "field"),
    [
        ({"from": "2024-01-01", "to": "2025-01-02"}, "query.to"),
        ({"from": "2026-11-03", "to": "2026-11-02"}, "query.to"),
        ({"from": "2026-11-03"}, "query.to"),
        ({"to": "2026-11-03"}, "query.from"),
        ({"from": "0", "to": "2026-11-03"}, "query.from"),
        ({"from": "2026-11-03", "to": "2026-11-3"}, "query.to"),
    ],
)
def test_the_range_is_required_and_bounded(
    client: TestClient, params: dict[str, str], field: str
) -> None:
    response = client.get("/api/v1/days", params=params)

    assert response.status_code == 422, response.text
    assert [error["field"] for error in response.json()["errors"]] == [field]


def test_extreme_values_stay_finite(client: TestClient) -> None:
    """The smallest Basis with the largest amounts must still be a number JSON can carry."""
    dense = {"basis_g": 0.001, "kcal": 10_000, "protein_g": 0.001, "carbs_g": 0, "fat_g": 0}
    food = new_food(client, "Dense", nutrition=dense, piece_g=1_000_000)
    eat(client, *[(food, 1_000_000, "count")] * 100)

    [day] = days(client)

    assert day["kcal"] == pytest.approx(1e21)
