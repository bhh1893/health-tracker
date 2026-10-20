import pytest

BAD_DATES = ["2024-2423", "86400", "2026-10-12T00:00:00", "20261012", "2026-1-5", "2026-02-30"]


@pytest.mark.parametrize("bad", BAD_DATES)
def test_meals_reject_anything_but_iso_dates(client, bad):
    r = client.get(f"/meals/{bad}")
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "validation_failed"


@pytest.mark.parametrize("bad", BAD_DATES)
def test_workout_list_rejects_anything_but_iso_dates(client, bad):
    assert client.get("/workouts", params={"date": bad}).status_code == 400


def test_a_valid_date_is_accepted(client):
    assert client.get("/meals/2026-10-12").status_code == 200
