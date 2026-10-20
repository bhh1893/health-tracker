import pytest

DAY = "2026-10-12"


@pytest.fixture
def logged(client, uid, make_food):
    """A meal with 200 g chicken and 3 eggs, plus the foods used."""
    chicken = make_food("chicken breast")  # 165 kcal / 31 g protein per 100 g
    egg = make_food("egg", basis="per_item", calories=72, protein_g=6.3, fat_g=4.8, carbs_g=0.4)
    body = {
        "id": uid(),
        "foods": [
            {"id": uid(), "food_id": chicken["id"], "quantity": 200},
            {"id": uid(), "food_id": egg["id"], "quantity": 3, "unit": "count"},
        ],
    }
    r = client.post(f"/meals/{DAY}", json=body)
    assert r.status_code == 201, r.text
    return {"body": body, "meal": r.json(), "chicken": chicken, "egg": egg}


def test_create_meal_snapshots_macros_and_sums_totals(logged):
    meal = logged["meal"]
    assert meal["label"] == "meal 1" and meal["position"] == 1
    assert [f["name"] for f in meal["foods"]] == ["chicken breast", "egg"]  # request order kept
    assert [f["calories"] for f in meal["foods"]] == [330, 216]
    assert meal["totals"]["calories"] == 546
    assert meal["totals"]["protein_g"] == pytest.approx(80.9)


def test_replaying_a_create_returns_200_and_creates_nothing_new(client, logged):
    r = client.post(f"/meals/{DAY}", json=logged["body"])
    assert r.status_code == 200
    day = client.get(f"/meals/{DAY}").json()
    assert len(day["meals"]) == 1 and len(day["meals"][0]["foods"]) == 2


def test_same_id_with_different_content_is_409(client, logged):
    changed = {**logged["body"], "foods": [{**logged["body"]["foods"][0], "quantity": 250}]}
    r = client.post(f"/meals/{DAY}", json=changed)
    assert r.status_code == 409 and r.json()["error"]["code"] == "idempotency_conflict"
    assert client.post("/meals/2026-10-13", json=logged["body"]).status_code == 409  # other day


def test_meals_are_numbered_per_day_and_labels_can_be_custom(client, uid):
    assert client.post(f"/meals/{DAY}", json={"id": uid()}).json()["label"] == "meal 1"
    assert client.post(f"/meals/{DAY}", json={"id": uid()}).json()["label"] == "meal 2"
    r = client.post(f"/meals/{DAY}", json={"id": uid(), "label": "  post workout "})
    assert r.json()["label"] == "post workout" and r.json()["position"] == 3
    assert client.post("/meals/2026-10-13", json={"id": uid()}).json()["label"] == "meal 1"


def test_a_food_must_use_the_unit_its_basis_expects(client, uid, make_food):
    chicken, egg = make_food("chicken breast"), make_food("egg", basis="per_item")
    meal = client.post(f"/meals/{DAY}", json={"id": uid()}).json()
    url = f"/meals/{DAY}/{meal['id']}/foods"
    r = client.post(url, json={"id": uid(), "food_id": egg["id"], "quantity": 2})  # default unit g
    assert r.status_code == 400 and r.json()["error"]["code"] == "unit_mismatch"
    r = client.post(url, json={"id": uid(), "food_id": chicken["id"], "quantity": 100, "unit": "count"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "unit_mismatch"


@pytest.mark.parametrize("item", [{}, {"quantity": 0.001}, {"quantity": -5}, {"quantity": 0}])
def test_quantity_is_required_and_positive(client, uid, make_food, item):
    chicken = make_food()
    meal = client.post(f"/meals/{DAY}", json={"id": uid()}).json()
    r = client.post(f"/meals/{DAY}/{meal['id']}/foods", json={"id": uid(), "food_id": chicken["id"], **item})
    assert r.status_code == 400


def test_unknown_and_archived_foods_are_rejected(client, uid, make_food):
    old = make_food("old thing")
    client.delete(f"/foods/{old['id']}")
    meal = client.post(f"/meals/{DAY}", json={"id": uid()}).json()
    url = f"/meals/{DAY}/{meal['id']}/foods"
    r = client.post(url, json={"id": uid(), "food_id": uid(), "quantity": 100})
    assert r.json()["error"]["code"] == "unknown_food"
    r = client.post(url, json={"id": uid(), "food_id": old["id"], "quantity": 100})
    assert r.json()["error"]["code"] == "food_archived"


def test_oversized_quantities_are_a_400_not_a_500(client, uid, make_food):
    huge = make_food("huge", basis="per_item", calories=10000)
    meal = client.post(f"/meals/{DAY}", json={"id": uid()}).json()
    r = client.post(
        f"/meals/{DAY}/{meal['id']}/foods",
        json={"id": uid(), "food_id": huge["id"], "quantity": 5000, "unit": "count"},
    )
    assert r.status_code == 400 and r.json()["error"]["code"] == "quantity_too_large"


def test_duplicate_entry_ids_in_one_request_are_400(client, uid, make_food):
    food, entry = make_food(), uid()
    foods = [{"id": entry, "food_id": food["id"], "quantity": 1}] * 2
    assert client.post(f"/meals/{DAY}", json={"id": uid(), "foods": foods}).status_code == 400


def test_a_bad_food_rolls_back_the_whole_meal(client, uid, make_food):
    food = make_food()
    bad = {"id": uid(), "foods": [
        {"id": uid(), "food_id": food["id"], "quantity": 100},
        {"id": uid(), "food_id": uid(), "quantity": 100},
    ]}
    assert client.post(f"/meals/{DAY}", json=bad).status_code == 400
    assert client.get(f"/meals/{DAY}").json()["meals"] == []
    assert client.post(f"/meals/{DAY}", json={"id": uid()}).json()["label"] == "meal 1"  # position not used up


def test_appending_a_food_and_retrying_it(client, uid, logged, make_food):
    rice = make_food("rice", calories=130, protein_g=2.7, fat_g=0.3, carbs_g=28)
    url = f"/meals/{DAY}/{logged['meal']['id']}/foods"
    entry = {"id": uid(), "food_id": rice["id"], "quantity": 150}
    r = client.post(url, json=entry)
    assert r.status_code == 201 and r.json()["totals"]["calories"] == 546 + 195
    r = client.post(url, json=entry)
    assert r.status_code == 200 and len(r.json()["foods"]) == 3  # retry: no duplicate
    assert client.post(url, json={**entry, "quantity": 99}).status_code == 409
    other = client.post(f"/meals/{DAY}", json={"id": uid()}).json()
    assert client.post(f"/meals/{DAY}/{other['id']}/foods", json=entry).status_code == 409
    client.delete(f"/foods/{rice['id']}")
    assert client.post(url, json=entry).status_code == 200  # replay survives archiving the food


def test_appending_to_an_unknown_meal_or_wrong_day_is_404(client, uid, logged):
    entry = {"id": uid(), "food_id": logged["chicken"]["id"], "quantity": 1}
    assert client.post(f"/meals/{DAY}/{uid()}/foods", json=entry).status_code == 404
    assert client.post(f"/meals/2026-10-13/{logged['meal']['id']}/foods", json=entry).status_code == 404


def test_history_is_frozen_when_the_catalog_changes(client, logged):
    client.patch(f"/foods/{logged['chicken']['id']}", json={"calories": 999})
    first = client.get(f"/meals/{DAY}").json()["meals"][0]["foods"][0]
    assert first["calories"] == 330


def test_changing_a_quantity_rescales_the_snapshot(client, logged):
    meal, item = logged["meal"], logged["meal"]["foods"][0]
    client.patch(f"/foods/{logged['chicken']['id']}", json={"calories": 999})  # must not matter
    r = client.patch(f"/meals/{DAY}/{meal['id']}/foods/{item['id']}", json={"quantity": 100})
    food = r.json()["foods"][0]
    assert r.status_code == 200 and food["quantity"] == 100 and food["calories"] == 165 and food["protein_g"] == 31


def test_rename_and_delete_meal_and_entries(client, uid, logged):
    meal, first, second = logged["meal"], logged["meal"]["foods"][0], logged["meal"]["foods"][1]
    r = client.patch(f"/meals/{DAY}/{meal['id']}", json={"label": "breakfast"})
    assert r.json()["label"] == "breakfast"
    assert client.patch(f"/meals/{DAY}/{uid()}", json={"label": "x"}).status_code == 404
    for _ in range(2):  # idempotent
        assert client.delete(f"/meals/{DAY}/{meal['id']}/foods/{first['id']}").status_code == 204
    assert [f["id"] for f in client.get(f"/meals/{DAY}").json()["meals"][0]["foods"]] == [second["id"]]
    for _ in range(2):
        assert client.delete(f"/meals/{DAY}/{meal['id']}").status_code == 204
    assert client.get(f"/meals/{DAY}").json()["meals"] == []


def test_an_empty_day_is_200_with_zero_totals(client):
    body = client.get("/meals/2026-01-01").json()
    assert body["meals"] == [] and body["day_totals"]["calories"] == 0


def test_day_totals_add_up_and_the_range_endpoint_agrees(client, uid, logged, make_food):
    rice = make_food("rice", calories=130, protein_g=2.7, fat_g=0.3, carbs_g=28)
    client.post(f"/meals/{DAY}", json={"id": uid(), "foods": [{"id": uid(), "food_id": rice["id"], "quantity": 100}]})
    day = client.get(f"/meals/{DAY}").json()
    assert day["day_totals"]["calories"] == pytest.approx(sum(m["totals"]["calories"] for m in day["meals"]))
    rows = client.get("/meals", params={"from": "2026-10-01", "to": "2026-10-31"}).json()
    assert len(rows) == 1 and rows[0]["date"] == DAY and rows[0]["meal_count"] == 2
    assert rows[0]["totals"]["calories"] == pytest.approx(day["day_totals"]["calories"])


@pytest.mark.parametrize(
    "params",
    [{"from": "2026-10-31", "to": "2026-10-01"}, {"from": "2020-01-01", "to": "2026-10-01"}, {"from": "2026-10-01"}],
)
def test_range_validation(client, params):
    assert client.get("/meals", params=params).status_code == 400
