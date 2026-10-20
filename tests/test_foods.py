import pytest

NIL = "00000000-0000-0000-0000-000000000000"
CHICKEN = {"name": "chicken breast", "basis": "per_100g", "calories": 165,
           "protein_g": 31, "fat_g": 3.6, "carbs_g": 0}


def test_create_food(client):
    r = client.post("/foods", json=CHICKEN)
    assert r.status_code == 201
    body = r.json()
    assert body["name"] == "chicken breast"
    assert body["fat_g"] == 3.6
    assert body["archived"] is False


def test_duplicate_name_is_409_ignoring_case(client, make_food):
    make_food("chicken breast")
    r = client.post("/foods", json={**CHICKEN, "name": "Chicken Breast"})
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "duplicate_name"


@pytest.mark.parametrize(
    "change",
    [{"calories": -1}, {"basis": "per_cup"}, {"name": "   "}, {"calories": 10**9}],
)
def test_invalid_food_is_400(client, change):
    r = client.post("/foods", json={**CHICKEN, **change})
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "validation_failed"


def test_missing_fields_is_400(client):
    assert client.post("/foods", json={"name": "z"}).status_code == 400


def test_search_is_a_case_insensitive_contains_match(client, make_food):
    make_food("chicken breast")
    make_food("Rotisserie Chicken")
    make_food("egg", basis="per_item")
    names = [f["name"] for f in client.get("/foods", params={"q": "CHICK"}).json()]
    assert names == ["chicken breast", "Rotisserie Chicken"]


def test_search_treats_percent_literally(client, make_food):
    make_food("100% whey")
    make_food("rice")
    names = [f["name"] for f in client.get("/foods", params={"q": "%"}).json()]
    assert names == ["100% whey"]


def test_archiving_hides_a_food_and_frees_its_name(client, make_food):
    food = make_food("chicken breast")
    assert client.delete(f"/foods/{food['id']}").status_code == 204
    assert client.get("/foods", params={"q": "chick"}).json() == []
    shown = client.get("/foods", params={"q": "chick", "include_archived": "true"}).json()
    assert [f["archived"] for f in shown] == [True]
    assert client.get(f"/foods/{food['id']}").status_code == 200  # still readable by id
    assert client.post("/foods", json=CHICKEN).status_code == 201  # name reusable
    assert client.patch(f"/foods/{food['id']}", json={"archived": False}).status_code == 409


def test_delete_is_idempotent(client, make_food):
    food = make_food()
    assert client.delete(f"/foods/{food['id']}").status_code == 204
    assert client.delete(f"/foods/{food['id']}").status_code == 204
    assert client.delete(f"/foods/{NIL}").status_code == 204


def test_patch_changes_only_the_fields_sent(client, make_food):
    food = make_food()
    r = client.patch(f"/foods/{food['id']}", json={"calories": 170})
    assert r.status_code == 200
    assert r.json()["calories"] == 170 and r.json()["protein_g"] == 31


@pytest.mark.parametrize("body", [{}, {"calories": None}])
def test_invalid_patch_is_400(client, make_food, body):
    food = make_food()
    assert client.patch(f"/foods/{food['id']}", json=body).status_code == 400


def test_rename_into_an_existing_name_is_409(client, make_food):
    make_food("egg")
    food = make_food("chicken breast")
    assert client.patch(f"/foods/{food['id']}", json={"name": "EGG"}).status_code == 409


def test_unknown_food_is_404_and_malformed_id_is_400(client):
    assert client.get(f"/foods/{NIL}").status_code == 404
    assert client.get("/foods/not-a-uuid").status_code == 400


def test_limit_is_validated(client):
    assert client.get("/foods", params={"limit": 500}).status_code == 400
