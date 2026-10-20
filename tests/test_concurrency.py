"""Parallel requests: the locks and retry detection must hold up under real concurrency."""
from collections import Counter
from concurrent.futures import ThreadPoolExecutor


def run_parallel(fn, n):
    with ThreadPoolExecutor(max_workers=n) as pool:
        return list(pool.map(lambda _: fn(), range(n)))


def test_identical_workout_starts_create_exactly_one(client, uid):
    body = {"id": uid(), "started_at": "2026-11-02T09:00:00-08:00"}
    responses = run_parallel(lambda: client.post("/workouts", json=body), 8)
    assert Counter(r.status_code for r in responses) == {201: 1, 200: 7}
    assert len(client.get("/workouts").json()) == 1


def test_parallel_sets_get_unique_consecutive_positions(client, uid, make_workout, make_exercise):
    w, ex = make_workout(), make_exercise()

    def post():
        return client.post(f"/workouts/{w['id']}/sets",
                           json={"id": uid(), "exercise_id": ex["id"], "weight_lbs": 135, "reps": 8})

    responses = run_parallel(post, 12)
    assert Counter(r.status_code for r in responses) == {201: 12}
    positions = sorted(s["position"] for s in client.get(f"/workouts/{w['id']}").json()["sets"])
    assert positions == list(range(1, 13))


def test_identical_set_posts_create_exactly_one(client, uid, make_workout, make_exercise):
    w, ex = make_workout(), make_exercise()
    body = {"id": uid(), "exercise_id": ex["id"], "weight_lbs": 135, "reps": 8}
    responses = run_parallel(lambda: client.post(f"/workouts/{w['id']}/sets", json=body), 8)
    assert Counter(r.status_code for r in responses) == {201: 1, 200: 7}
    assert len(client.get(f"/workouts/{w['id']}").json()["sets"]) == 1


def test_parallel_meals_on_one_day_get_unique_positions(client, uid):
    responses = run_parallel(lambda: client.post("/meals/2026-11-02", json={"id": uid()}), 12)
    assert Counter(r.status_code for r in responses) == {201: 12}
    positions = sorted(m["position"] for m in client.get("/meals/2026-11-02").json()["meals"])
    assert positions == list(range(1, 13))


def test_identical_meal_posts_create_exactly_one(client, uid, make_food):
    food = make_food()
    body = {"id": uid(), "foods": [{"id": uid(), "food_id": food["id"], "quantity": 100}]}
    responses = run_parallel(lambda: client.post("/meals/2026-11-02", json=body), 8)
    assert Counter(r.status_code for r in responses) == {201: 1, 200: 7}
    meals = client.get("/meals/2026-11-02").json()["meals"]
    assert len(meals) == 1 and len(meals[0]["foods"]) == 1
