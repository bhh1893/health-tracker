"""The schema must make exercise history easy. These are the queries a future
GET /exercises/{id}/history endpoint would run."""
from app.db import pool

HISTORY = (
    "SELECT w.day, s.position, s.weight_lbs, s.reps "
    "FROM sets s JOIN workouts w ON w.id = s.workout_id "
    "WHERE s.exercise_id = %s "
    "ORDER BY w.day DESC, w.started_at DESC, s.position"
)
AS_OF = (
    "SELECT w.day, s.position, s.weight_lbs, s.reps "
    "FROM sets s JOIN workouts w ON w.id = s.workout_id "
    "WHERE s.exercise_id = %s AND w.day = ("
    "  SELECT MAX(w2.day) FROM sets s2 JOIN workouts w2 ON w2.id = s2.workout_id "
    "  WHERE s2.exercise_id = %s AND w2.day <= %s) "
    "ORDER BY w.started_at, s.position"
)


def test_exercise_history(client, uid, make_workout, make_exercise):
    deadlift, bench = make_exercise("deadlift"), make_exercise("bench press")
    sessions = {
        "2026-10-05": [(225, 5), (245, 3), (265, 1)],
        "2026-10-08": [(225, 5), (255, 3)],
        "2026-10-12": [(275, 1)],
    }
    for day, sets in sessions.items():
        w = make_workout(f"{day}T18:00:00-07:00")
        for weight, reps in sets + [(95, 10)]:
            exercise = deadlift if (weight, reps) != (95, 10) else bench  # noise from another exercise
            client.post(f"/workouts/{w['id']}/sets",
                        json={"id": uid(), "exercise_id": exercise["id"], "weight_lbs": weight, "reps": reps})

    with pool.connection() as conn:
        history = conn.execute(HISTORY, (deadlift["id"],)).fetchall()
        as_of = conn.execute(AS_OF, (deadlift["id"], deadlift["id"], "2026-10-10")).fetchall()
        before_any = conn.execute(AS_OF, (deadlift["id"], deadlift["id"], "2026-10-01")).fetchall()

    assert [str(r["day"]) for r in history] == ["2026-10-12"] + ["2026-10-08"] * 2 + ["2026-10-05"] * 3
    assert [(str(r["day"]), float(r["weight_lbs"]), r["reps"]) for r in as_of] == [
        ("2026-10-08", 225.0, 5), ("2026-10-08", 255.0, 3)]
    assert before_any == []
