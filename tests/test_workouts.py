import pytest


def add_set(client, uid, workout_id, exercise_id, weight=135, reps=8, **extra):
    return client.post(
        f"/workouts/{workout_id}/sets",
        json={"id": uid(), "exercise_id": exercise_id, "weight_lbs": weight, "reps": reps, **extra},
    )


def test_start_workout_uses_the_local_date_from_the_offset(client, uid):
    body = {"id": uid(), "started_at": "2026-10-12T23:30:00-07:00", "name": "leg day"}
    r = client.post("/workouts", json=body)
    assert r.status_code == 201
    assert r.json()["date"] == "2026-10-12"  # not the UTC date (10-13)
    assert r.json()["sets"] == [] and r.json()["ended_at"] is None


def test_replaying_a_start_is_200_and_a_different_body_is_409(client, uid):
    body = {"id": uid(), "started_at": "2026-10-12T18:00:00-07:00", "name": "push"}
    assert client.post("/workouts", json=body).status_code == 201
    assert client.post("/workouts", json=body).status_code == 200
    assert len(client.get("/workouts").json()) == 1
    r = client.post("/workouts", json={**body, "started_at": "2026-10-12T18:05:00-07:00"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "idempotency_conflict"


@pytest.mark.parametrize("started_at", ["2026-10-12T10:00:00", "yesterday"])
def test_started_at_needs_a_real_timestamp_with_an_offset(client, uid, started_at):
    assert client.post("/workouts", json={"id": uid(), "started_at": started_at}).status_code == 400


def test_sets_get_positions_and_carry_the_exercise_name(client, uid, make_workout, make_exercise):
    w, bench = make_workout(), make_exercise("Bench Press")
    r = add_set(client, uid, w["id"], bench["id"], weight=135.5, notes="easy")
    assert r.status_code == 201
    first = r.json()["sets"][0]
    assert first["position"] == 1 and first["exercise"] == "Bench Press"
    assert first["exercise_id"] == bench["id"] and first["weight_lbs"] == 135.5
    assert [s["position"] for s in add_set(client, uid, w["id"], bench["id"]).json()["sets"]] == [1, 2]


def test_replaying_a_set(client, uid, make_workout, make_exercise):
    w, bench = make_workout(), make_exercise()
    body = {"id": uid(), "exercise_id": bench["id"], "weight_lbs": 135, "reps": 8}
    url = f"/workouts/{w['id']}/sets"
    assert client.post(url, json=body).status_code == 201
    r = client.post(url, json=body)
    assert r.status_code == 200 and len(r.json()["sets"]) == 1
    assert client.post(url, json={**body, "reps": 9}).status_code == 409
    client.delete(f"/exercises/{bench['id']}")
    assert client.post(url, json=body).status_code == 200  # replay survives archiving the exercise


def test_a_set_must_reference_a_real_active_exercise(client, uid, make_workout, make_exercise):
    w, old = make_workout(), make_exercise("old")
    client.delete(f"/exercises/{old['id']}")
    url = f"/workouts/{w['id']}/sets"
    base = {"id": uid(), "weight_lbs": 10, "reps": 5}
    assert client.post(url, json={**base, "exercise_id": uid()}).json()["error"]["code"] == "unknown_exercise"
    assert client.post(url, json={**base, "id": uid(), "exercise_id": old["id"]}).json()["error"]["code"] == "exercise_archived"
    assert client.post(url, json={**base, "exercise": "bench press"}).status_code == 400  # free text is gone
    assert client.post(url, json={**base, "exercise_id": "nope"}).status_code == 400


@pytest.mark.parametrize("change", [{"reps": 0}, {"reps": 8.5}, {"weight_lbs": -1}, {"weight_lbs": 5000}])
def test_set_values_are_validated(client, uid, make_workout, make_exercise, change):
    w, bench = make_workout(), make_exercise()
    base = {"id": uid(), "exercise_id": bench["id"], "weight_lbs": 100, "reps": 5}
    assert client.post(f"/workouts/{w['id']}/sets", json={**base, **change}).status_code == 400


def test_appending_to_an_unknown_workout_is_404(client, uid, make_exercise):
    assert add_set(client, uid, uid(), make_exercise()["id"]).status_code == 404


def test_renaming_an_exercise_renames_it_in_past_workouts(client, uid, make_workout, make_exercise):
    w, squat = make_workout(), make_exercise("front squat")
    add_set(client, uid, w["id"], squat["id"])
    client.patch(f"/exercises/{squat['id']}", json={"name": "Front Squat (barbell)"})
    assert client.get(f"/workouts/{w['id']}").json()["sets"][0]["exercise"] == "Front Squat (barbell)"


def test_patching_a_set(client, uid, make_workout, make_exercise):
    w, bench, squat = make_workout(), make_exercise("bench"), make_exercise("squat")
    set_id = add_set(client, uid, w["id"], bench["id"], notes="first").json()["sets"][0]["id"]
    url = f"/workouts/{w['id']}/sets/{set_id}"
    assert client.patch(url, json={"reps": 7, "exercise_id": squat["id"]}).json()["sets"][0]["exercise"] == "squat"
    assert client.patch(url, json={"notes": None}).json()["sets"][0]["notes"] is None
    assert client.patch(url, json={"exercise_id": uid()}).status_code == 400
    assert client.patch(url, json={"exercise_id": None}).status_code == 400
    assert client.patch(url, json={"reps": None}).status_code == 400
    assert client.patch(url, json={}).status_code == 400
    assert client.patch(f"/workouts/{w['id']}/sets/{uid()}", json={"reps": 5}).status_code == 404


def test_ending_reopening_and_the_open_filter(client, uid, make_workout, make_exercise):
    w, ex = make_workout("2026-10-12T18:00:00-07:00", name="push"), make_exercise()
    url = f"/workouts/{w['id']}"
    assert [x["id"] for x in client.get("/workouts", params={"open": "true"}).json()] == [w["id"]]
    assert client.patch(url, json={"ended_at": "2026-10-12T17:00:00-07:00"}).status_code == 400  # before start
    assert client.patch(url, json={"ended_at": "2026-10-12T19:00:00-07:00"}).json()["ended_at"] is not None
    assert client.get("/workouts", params={"open": "true"}).json() == []
    assert add_set(client, uid, w["id"], ex["id"]).status_code == 201  # ended workouts still accept sets
    r = client.patch(url, json={"ended_at": None, "name": None})
    assert r.json()["ended_at"] is None and r.json()["name"] is None
    assert client.patch(url, json={}).status_code == 400
    assert client.patch(f"/workouts/{uid()}", json={"name": "x"}).status_code == 404


def test_list_filters(client, make_workout):
    a = make_workout("2026-10-12T09:00:00-07:00")
    b = make_workout("2026-10-12T18:00:00-07:00")
    c = make_workout("2026-10-14T08:00:00-07:00")
    ids = lambda **p: [w["id"] for w in client.get("/workouts", params=p).json()]
    assert ids(date="2026-10-12") == [b["id"], a["id"]]  # newest first
    assert ids(**{"from": "2026-10-12", "to": "2026-10-14"}) == [c["id"], b["id"], a["id"]]
    assert ids() == [c["id"], b["id"], a["id"]] and len(ids(limit=2)) == 2


@pytest.mark.parametrize(
    "params",
    [
        {"date": "2026-10-12", "from": "2026-10-01", "to": "2026-10-31"},
        {"from": "2026-10-01"},
        {"from": "2026-10-31", "to": "2026-10-01"},
        {"from": "2020-01-01", "to": "2026-10-01"},
        {"limit": 500},
    ],
)
def test_list_validation(client, params):
    assert client.get("/workouts", params=params).status_code == 400


def test_get_unknown_and_malformed_ids_and_the_removed_current_route(client, uid):
    assert client.get(f"/workouts/{uid()}").status_code == 404
    assert client.get("/workouts/not-a-uuid").status_code == 400
    assert client.get("/workouts/current").status_code == 400  # 'current' is not a uuid


def test_deleting_a_workout_removes_its_sets(client, uid, make_workout, make_exercise):
    w, ex = make_workout(), make_exercise()
    set_id = add_set(client, uid, w["id"], ex["id"]).json()["sets"][0]["id"]
    for _ in range(2):  # idempotent
        assert client.delete(f"/workouts/{w['id']}/sets/{set_id}").status_code == 204
    add_set(client, uid, w["id"], ex["id"])
    for _ in range(2):
        assert client.delete(f"/workouts/{w['id']}").status_code == 204
    assert client.get(f"/workouts/{w['id']}").status_code == 404
