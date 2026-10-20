import pytest

NIL = "00000000-0000-0000-0000-000000000000"


def test_create_tidies_the_name_and_keeps_the_note(client):
    r = client.post("/exercises", json={"name": "  Bench   Press ", "muscle_area": "upper body / chest"})
    assert r.status_code == 201
    assert r.json()["name"] == "Bench Press"
    assert r.json()["muscle_area"] == "upper body / chest"


def test_muscle_area_is_optional(client):
    r = client.post("/exercises", json={"name": "front squat"})
    assert r.status_code == 201 and r.json()["muscle_area"] is None


@pytest.mark.parametrize("name", ["bench press", "BENCH    PRESS"])
def test_duplicate_names_are_409_ignoring_case_and_spacing(client, make_exercise, name):
    make_exercise("Bench Press")
    r = client.post("/exercises", json={"name": name})
    assert r.status_code == 409 and r.json()["error"]["code"] == "duplicate_name"


@pytest.mark.parametrize("body", [{}, {"name": "   "}, {"name": "x" * 101}])
def test_invalid_exercise_is_400(client, body):
    assert client.post("/exercises", json=body).status_code == 400


def test_search_matches_the_name_or_the_muscle_note(client, make_exercise):
    make_exercise("ez bar curl", "arms / biceps")
    make_exercise("Bench Press", "chest")
    assert [e["name"] for e in client.get("/exercises", params={"q": "bicep"}).json()] == ["ez bar curl"]
    assert [e["name"] for e in client.get("/exercises", params={"q": "PRESS"}).json()] == ["Bench Press"]


def test_list_is_sorted_by_name(client, make_exercise):
    for name in ["front squat", "Bench Press", "ez bar curl"]:
        make_exercise(name)
    assert [e["name"] for e in client.get("/exercises").json()] == ["Bench Press", "ez bar curl", "front squat"]


def test_patch_can_rename_and_clear_the_note(client, make_exercise):
    ex = make_exercise("curl", "biceps")
    r = client.patch(f"/exercises/{ex['id']}", json={"name": "EZ  Bar Curl", "muscle_area": None})
    assert r.status_code == 200
    assert r.json()["name"] == "EZ Bar Curl" and r.json()["muscle_area"] is None


@pytest.mark.parametrize("body", [{}, {"name": None}])
def test_invalid_patch_is_400(client, make_exercise, body):
    ex = make_exercise()
    assert client.patch(f"/exercises/{ex['id']}", json=body).status_code == 400


def test_rename_into_an_existing_name_is_409(client, make_exercise):
    make_exercise("deadlift")
    ex = make_exercise("rdl")
    assert client.patch(f"/exercises/{ex['id']}", json={"name": "Deadlift"}).status_code == 409


def test_archiving_hides_an_exercise_and_frees_its_name(client, make_exercise):
    ex = make_exercise("bench press")
    assert client.delete(f"/exercises/{ex['id']}").status_code == 204
    assert client.delete(f"/exercises/{ex['id']}").status_code == 204  # idempotent
    assert client.get("/exercises").json() == []
    assert len(client.get("/exercises", params={"include_archived": "true"}).json()) == 1
    assert client.post("/exercises", json={"name": "bench press"}).status_code == 201
    assert client.patch(f"/exercises/{ex['id']}", json={"archived": False}).status_code == 409


def test_unknown_is_404_and_malformed_id_is_400(client):
    assert client.get(f"/exercises/{NIL}").status_code == 404
    assert client.get("/exercises/nope").status_code == 400
