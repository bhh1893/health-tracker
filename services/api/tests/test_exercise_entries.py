"""Exercise Entries and Sessions on real Postgres, as the limited role `api` uses (ADR 0006)."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4, uuid7

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from health_api.exercise_entries import DEFAULT_SESSIONS, MAX_REPS
from health_api.problems import PROBLEM_MEDIA_TYPE

ENTRIES = "/api/v1/exercise-entries"


def entry_url(entry: UUID | str) -> str:
    return f"{ENTRIES}/{entry}"


def sessions_url(exercise: UUID) -> str:
    return f"/api/v1/exercises/{exercise}/sessions"


def create_exercise(client: TestClient, name: str) -> UUID:
    exercise = uuid7()
    response = client.put(
        f"/api/v1/exercises/{exercise}", json={"name": name, "allow_similar": True}
    )
    assert response.status_code == 201, response.text
    return exercise


def body(exercise: UUID, at: str = "2026-11-03T12:00:00+00:00", **fields: Any) -> dict[str, Any]:
    return {
        "exercise_id": str(exercise),
        "reps": 5,
        "weight_lb": 135.5,
        "occurred_at": at,
        "occurred_tz": "UTC",
        **fields,
    }


def put(client: TestClient, fields: dict[str, Any]) -> dict[str, Any]:
    response = client.put(entry_url(uuid7()), json=fields)
    assert response.status_code == 201, response.text
    return response.json()


def list_ids(client: TestClient, **params: Any) -> list[str]:
    response = client.get(ENTRIES, params=params)
    assert response.status_code == 200, response.text
    return [entry["id"] for entry in response.json()["items"]]


def error_fields(response: Any) -> list[str]:
    assert response.status_code == 422, response.text
    return [error["field"] for error in response.json()["errors"]]


def sessions(client: TestClient, exercise: UUID, **params: Any) -> list[dict[str, Any]]:
    response = client.get(sessions_url(exercise), params=params)
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def squat(client: TestClient) -> UUID:
    return create_exercise(client, "Squat")


@pytest.fixture
def other_user(session: Session) -> UUID:
    return session.execute(text("INSERT INTO users DEFAULT VALUES RETURNING id")).scalar_one()


def foreign_exercise(session: Session, owner: UUID) -> UUID:
    return session.execute(
        text("INSERT INTO exercises (user_id, name) VALUES (:user, 'Theirs') RETURNING id"),
        {"user": owner},
    ).scalar_one()


def foreign_entry(session: Session, owner: UUID) -> UUID:
    return session.execute(
        text(
            """
            INSERT INTO exercise_entries
                (user_id, exercise_id, reps, occurred_at, occurred_tz, day)
            VALUES (:user, :exercise, 5, '2026-11-03T12:00:00Z', 'UTC', '2026-11-03')
            RETURNING id
            """
        ),
        {"user": owner, "exercise": foreign_exercise(session, owner)},
    ).scalar_one()


# Writing and reading one Entry


def test_entry_round_trip(client: TestClient, squat: UUID) -> None:
    entry = uuid7()
    fields = body(squat, at="2026-11-03T20:30:00-05:00", occurred_tz="America/New_York")

    created = client.put(entry_url(entry), json=fields)
    read = client.get(entry_url(entry))

    assert created.status_code == 201
    assert read.json() == created.json()
    assert read.json() == {
        "id": str(entry),
        "exercise": {"id": str(squat), "name": "Squat", "archived": False},
        "reps": 5,
        "weight_lb": 135.5,
        "occurred_at": "2026-11-03T20:30:00-05:00",
        "occurred_tz": "America/New_York",
        "day": "2026-11-03",
        "number": 1,
    }


@pytest.mark.parametrize("fields", [{"weight_lb": None}, {}])
def test_no_weight_is_bodyweight(client: TestClient, squat: UUID, fields: dict[str, Any]) -> None:
    sent = {key: value for key, value in body(squat).items() if key != "weight_lb"}

    assert put(client, sent | fields)["weight_lb"] is None


def test_replace_swaps_every_field(client: TestClient, squat: UUID) -> None:
    bench = create_exercise(client, "Bench Press")
    entry = uuid7()
    client.put(entry_url(entry), json=body(squat))

    replaced = client.put(
        entry_url(entry),
        json=body(bench, at="2026-11-04T07:00:00+09:00", reps=8, occurred_tz="Asia/Tokyo")
        | {"weight_lb": None},
    )

    assert replaced.status_code == 200
    assert replaced.json() == {
        "id": str(entry),
        "exercise": {"id": str(bench), "name": "Bench Press", "archived": False},
        "reps": 8,
        "weight_lb": None,
        "occurred_at": "2026-11-04T07:00:00+09:00",
        "occurred_tz": "Asia/Tokyo",
        "day": "2026-11-04",
        "number": 1,
    }


def test_retried_put_is_harmless(client: TestClient, session: Session, squat: UUID) -> None:
    entry = uuid7()

    first = client.put(entry_url(entry), json=body(squat))
    retry = client.put(entry_url(entry), json=body(squat))

    assert (first.status_code, retry.status_code) == (201, 200)
    assert retry.json() == first.json()
    count = session.execute(text("SELECT count(*) FROM exercise_entries")).scalar_one()
    assert count == 1


def test_replace_keeps_logged_at(client: TestClient, session: Session, squat: UUID) -> None:
    entry = uuid7()
    client.put(entry_url(entry), json=body(squat))
    backdated = "2020-01-01T00:00:00Z"
    session.execute(
        text("UPDATE exercise_entries SET logged_at = :at, updated_at = :at WHERE id = :id"),
        {"at": backdated, "id": entry},
    )

    client.put(entry_url(entry), json=body(squat, reps=6))

    logged_at, updated_at = session.execute(
        text("SELECT logged_at, updated_at FROM exercise_entries WHERE id = :id"), {"id": entry}
    ).one()
    assert logged_at == datetime(2020, 1, 1, tzinfo=UTC)
    assert updated_at > logged_at


def test_delete_and_a_retry_are_both_204(client: TestClient, squat: UUID) -> None:
    entry = uuid7()
    client.put(entry_url(entry), json=body(squat))

    assert client.delete(entry_url(entry)).status_code == 204
    assert client.get(entry_url(entry)).status_code == 404
    assert client.delete(entry_url(entry)).status_code == 204


def test_deleting_a_row_that_never_existed_is_204(client: TestClient) -> None:
    assert client.delete(entry_url(uuid7())).status_code == 204


def test_missing_entry_is_a_problem(client: TestClient) -> None:
    response = client.get(entry_url(uuid7()))

    assert response.status_code == 404
    assert response.headers["content-type"] == PROBLEM_MEDIA_TYPE


def test_writes_commit(committing_client: TestClient) -> None:
    exercise = create_exercise(committing_client, "Squat")
    entry = uuid7()

    created = committing_client.put(entry_url(entry), json=body(exercise))
    read = committing_client.get(entry_url(entry))

    assert created.status_code == 201
    assert read.status_code == 200

    assert committing_client.delete(entry_url(entry)).status_code == 204
    assert committing_client.get(entry_url(entry)).status_code == 404


def test_racing_first_attempts_create_one_entry(committing_client: TestClient) -> None:
    """A phone retrying on bad Wi-Fi: both reach the server, and only one created the Set."""
    exercise = create_exercise(committing_client, "Squat")
    entry = uuid7()

    def attempt(_: int) -> int:
        return committing_client.put(entry_url(entry), json=body(exercise)).status_code

    with ThreadPoolExecutor(max_workers=8) as pool:
        statuses = list(pool.map(attempt, range(8)))

    assert sorted(statuses) == [200] * 7 + [201]


# Ownership


def test_another_users_entry_looks_missing(
    client: TestClient, session: Session, squat: UUID, other_user: UUID
) -> None:
    theirs = foreign_entry(session, other_user)

    assert client.get(entry_url(theirs)).status_code == 404
    assert list_ids(client) == []
    assert client.delete(entry_url(theirs)).status_code == 204
    still_there = session.execute(
        text("SELECT count(*) FROM exercise_entries WHERE id = :id"), {"id": theirs}
    ).scalar_one()
    assert still_there == 1


def test_put_on_another_users_id_looks_missing_and_writes_nothing(
    client: TestClient, session: Session, squat: UUID, other_user: UUID
) -> None:
    theirs = foreign_entry(session, other_user)

    # Their rows have UUIDv7 ids in production; the default uuidv7() gives one here too.
    assert client.put(entry_url(theirs), json=body(squat, reps=99)).status_code == 404
    reps = session.execute(
        text("SELECT reps FROM exercise_entries WHERE id = :id"), {"id": theirs}
    ).scalar_one()
    assert reps == 5


def test_another_users_exercise_is_rejected(
    client: TestClient, session: Session, other_user: UUID
) -> None:
    theirs = foreign_exercise(session, other_user)

    response = client.put(entry_url(uuid7()), json=body(theirs))

    assert error_fields(response) == ["body.exercise_id"]


def test_unknown_exercise_is_rejected(client: TestClient) -> None:
    response = client.put(entry_url(uuid7()), json=body(uuid7()))

    assert error_fields(response) == ["body.exercise_id"]


def test_archived_exercise_can_stay_on_an_entry(client: TestClient, squat: UUID) -> None:
    entry = uuid7()
    client.put(entry_url(entry), json=body(squat))
    client.patch(f"/api/v1/exercises/{squat}", json={"archived": True})

    read = client.get(entry_url(entry)).json()
    replaced = client.put(entry_url(entry), json=body(squat, reps=6))

    assert read["exercise"]["archived"] is True
    assert replaced.status_code == 200


# Validation


def test_put_requires_a_uuid7(client: TestClient, squat: UUID) -> None:
    assert client.put(entry_url(uuid4()), json=body(squat)).status_code == 422


@pytest.mark.parametrize(
    ("fields", "field"),
    [
        ({"reps": 0}, "reps"),
        ({"reps": -1}, "reps"),
        ({"reps": 1.5}, "reps"),
        ({"reps": None}, "reps"),
        ({"reps": MAX_REPS + 1}, "reps"),
        ({"weight_lb": 0}, "weight_lb"),
        ({"weight_lb": -5}, "weight_lb"),
        ({"weight_lb": "heavy"}, "weight_lb"),
        ({"exercise_id": "x"}, "exercise_id"),
        ({"occurred_at": "2026-11-03T12:00:00"}, "occurred_at"),
        ({"occurred_at": "1730000000"}, "occurred_at"),
        ({"occurred_at": "2026-02-30T12:00:00Z"}, "occurred_at"),
        ({"occurred_tz": "Mars/Olympus"}, "occurred_tz"),
        ({"occurred_tz": "../etc/passwd"}, "occurred_tz"),
        ({"day": "2026-11-03"}, "day"),
        ({"number": 3}, "number"),
    ],
)
def test_invalid_fields_are_rejected(
    client: TestClient, squat: UUID, fields: dict[str, Any], field: str
) -> None:
    response = client.put(entry_url(uuid7()), json=body(squat) | fields)

    assert any(field in name for name in error_fields(response))


def test_the_largest_reps_fit_the_column(client: TestClient, squat: UUID) -> None:
    assert put(client, body(squat, reps=MAX_REPS))["reps"] == MAX_REPS


def test_occurred_at_may_be_only_slightly_in_the_future(client: TestClient, squat: UUID) -> None:
    now = datetime.now(UTC)
    soon = (now + timedelta(minutes=4)).isoformat()
    later = (now + timedelta(minutes=6)).isoformat()

    assert client.put(entry_url(uuid7()), json=body(squat, at=soon)).status_code == 201
    assert client.put(entry_url(uuid7()), json=body(squat, at=later)).status_code == 422


@pytest.mark.parametrize("at", ["0001-01-01T00:00:00+14:00", "9999-12-31T23:59:59-14:00"])
def test_extreme_timestamps_are_invalid_not_a_crash(
    client: TestClient, squat: UUID, at: str
) -> None:
    assert client.put(entry_url(uuid7()), json=body(squat, at=at)).status_code == 422


# Timezones and the Day


@pytest.mark.parametrize(
    ("at", "tz", "day"),
    [
        # The same instant is two Days, depending on where the user stood.
        ("2026-11-04T04:30:00Z", "America/Los_Angeles", "2026-11-03"),
        ("2026-11-04T04:30:00Z", "Asia/Tokyo", "2026-11-04"),
        # The offset sent is only a way of writing the moment; occurred_tz decides the Day.
        ("2026-11-03T23:30:00-05:00", "Asia/Tokyo", "2026-11-04"),
        # Kiritimati is UTC+14, and Pago Pago UTC-11: the widest gap there is.
        ("2026-11-03T12:00:00Z", "Pacific/Kiritimati", "2026-11-04"),
        ("2026-11-03T10:00:00Z", "Pacific/Pago_Pago", "2026-11-02"),
        # A half-hour zone.
        ("2026-11-03T18:45:00Z", "Asia/Kolkata", "2026-11-04"),
        # Midnight belongs to the Day it starts.
        ("2026-11-03T05:00:00Z", "America/New_York", "2026-11-03"),
        ("2026-11-03T04:59:59Z", "America/New_York", "2026-11-02"),
    ],
)
def test_day_is_the_date_where_the_user_was(
    client: TestClient, squat: UUID, at: str, tz: str, day: str
) -> None:
    assert put(client, body(squat, at=at, occurred_tz=tz))["day"] == day


def test_occurred_at_comes_back_in_occurred_tz_whatever_offset_was_sent(
    client: TestClient, squat: UUID
) -> None:
    entry = put(client, body(squat, at="2026-11-04T04:30:00Z", occurred_tz="Asia/Tokyo"))

    assert entry["occurred_at"] == "2026-11-04T13:30:00+09:00"


def test_the_repeated_hour_keeps_its_two_offsets(client: TestClient, squat: UUID) -> None:
    """Clocks go back on 2026-11-01, so 01:30 in New York happens twice, an hour apart."""
    tz = {"occurred_tz": "America/New_York"}

    first = put(client, body(squat, at="2026-11-01T05:30:00Z", **tz))
    second = put(client, body(squat, at="2026-11-01T06:30:00Z", **tz))

    assert first["occurred_at"] == "2026-11-01T01:30:00-04:00"
    assert second["occurred_at"] == "2026-11-01T01:30:00-05:00"
    assert (first["number"], second["number"]) == (1, 2)


def test_a_day_with_a_skipped_hour_still_computes(client: TestClient, squat: UUID) -> None:
    """Clocks go forward on 2026-03-08, so New York's 03:00 follows 01:59."""
    entry = put(client, body(squat, at="2026-03-08T07:00:00Z", occurred_tz="America/New_York"))

    assert entry["occurred_at"] == "2026-03-08T03:00:00-04:00"
    assert entry["day"] == "2026-03-08"


def test_editing_the_time_moves_the_entry_to_its_new_day(client: TestClient, squat: UUID) -> None:
    entry = uuid7()
    client.put(entry_url(entry), json=body(squat, at="2026-11-03T12:00:00Z"))

    moved = client.put(entry_url(entry), json=body(squat, at="2026-11-02T12:00:00Z"))

    assert moved.json()["day"] == "2026-11-02"
    assert list_ids(client, **{"from": "2026-11-03", "to": "2026-11-03"}) == []


def test_changing_only_the_timezone_recomputes_the_day(client: TestClient, squat: UUID) -> None:
    entry = uuid7()
    at = "2026-11-04T04:30:00Z"
    client.put(entry_url(entry), json=body(squat, at=at, occurred_tz="America/Los_Angeles"))

    moved = client.put(entry_url(entry), json=body(squat, at=at, occurred_tz="Asia/Tokyo"))

    assert moved.json()["day"] == "2026-11-04"


# Set numbers


def test_numbers_follow_occurred_at_not_the_order_logged(client: TestClient, squat: UUID) -> None:
    late = put(client, body(squat, at="2026-11-03T12:10:00Z"))
    forgotten = put(client, body(squat, at="2026-11-03T12:00:00Z"))

    assert forgotten["number"] == 1
    assert client.get(entry_url(late["id"])).json()["number"] == 2


def test_numbers_count_within_one_exercise_and_day(client: TestClient, squat: UUID) -> None:
    bench = create_exercise(client, "Bench Press")

    put(client, body(squat, at="2026-11-03T12:00:00Z"))
    other_exercise = put(client, body(bench, at="2026-11-03T12:05:00Z"))
    second = put(client, body(squat, at="2026-11-03T12:10:00Z"))
    other_day = put(client, body(squat, at="2026-11-04T12:00:00Z"))

    assert other_exercise["number"] == 1
    assert second["number"] == 2
    assert other_day["number"] == 1


def test_numbers_close_up_after_a_delete(client: TestClient, squat: UUID) -> None:
    first = put(client, body(squat, at="2026-11-03T12:00:00Z"))
    second = put(client, body(squat, at="2026-11-03T12:10:00Z"))

    client.delete(entry_url(first["id"]))

    assert client.get(entry_url(second["id"])).json()["number"] == 1


def test_a_page_boundary_keeps_the_real_numbers(client: TestClient, squat: UUID) -> None:
    for minute in (0, 10, 20):
        put(client, body(squat, at=f"2026-11-03T12:{minute:02}:00Z"))

    page = client.get(ENTRIES, params={"limit": 1}).json()

    assert page["items"][0]["number"] == 3


# The range feed


def test_list_filters_by_inclusive_day_range(client: TestClient, squat: UUID) -> None:
    days = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"]
    ids = [put(client, body(squat, at=f"{day}T12:00:00Z"))["id"] for day in days]

    assert list_ids(client, **{"from": "2026-11-02", "to": "2026-11-03"}) == [ids[2], ids[1]]
    assert list_ids(client, **{"from": "2026-11-03", "to": "2026-11-03"}) == [ids[2]]
    assert list_ids(client, **{"from": "2026-11-03"}) == [ids[3], ids[2]]
    assert list_ids(client, to="2026-11-02") == [ids[1], ids[0]]


def test_list_filters_by_exercise(client: TestClient, squat: UUID) -> None:
    bench = create_exercise(client, "Bench Press")
    mine = put(client, body(squat))
    put(client, body(bench))

    assert list_ids(client, exercise_id=str(squat)) == [mine["id"]]
    assert list_ids(client, exercise_id=str(uuid7())) == []


def test_list_is_newest_first_by_day_even_across_timezones(client: TestClient, squat: UUID) -> None:
    """Tokyo's Day is later, though its moment is earlier: the Day sorts first."""
    los_angeles = put(
        client, body(squat, at="2026-11-04T05:00:00Z", occurred_tz="America/Los_Angeles")
    )
    tokyo = put(client, body(squat, at="2026-11-04T04:00:00Z", occurred_tz="Asia/Tokyo"))

    assert (los_angeles["day"], tokyo["day"]) == ("2026-11-03", "2026-11-04")
    assert list_ids(client) == [tokyo["id"], los_angeles["id"]]


def test_cursor_walks_every_entry_once(client: TestClient, squat: UUID) -> None:
    # Two share a moment across the limit=2 page boundary, so only the id can order them.
    moments = ["08:00:00", "09:00:00", "12:00:00", "12:00:00", "21:00:00"]
    created = [put(client, body(squat, at=f"2026-11-03T{at}Z"))["id"] for at in moments]

    seen: list[str] = []
    cursor = None
    pages = 0
    while True:
        params: dict[str, Any] = {"limit": 2} | ({"cursor": cursor} if cursor else {})
        page = client.get(ENTRIES, params=params).json()
        seen += [entry["id"] for entry in page["items"]]
        pages += 1
        cursor = page["next_cursor"]
        if cursor is None:
            break

    assert seen == list(reversed(created))
    assert pages == 3


def test_cursor_keeps_the_filters_it_is_sent_with(client: TestClient, squat: UUID) -> None:
    bench = create_exercise(client, "Bench Press")
    oldest = put(client, body(squat, at="2026-11-03T08:00:00Z"))
    put(client, body(bench, at="2026-11-03T09:00:00Z"))
    newest = put(client, body(squat, at="2026-11-03T10:00:00Z"))

    first = client.get(ENTRIES, params={"exercise_id": str(squat), "limit": 1}).json()
    rest = client.get(
        ENTRIES, params={"exercise_id": str(squat), "cursor": first["next_cursor"]}
    ).json()

    assert first["items"][0]["id"] == newest["id"]
    assert [entry["id"] for entry in rest["items"]] == [oldest["id"]]


def test_a_full_last_page_has_no_next_cursor(client: TestClient, squat: UUID) -> None:
    put(client, body(squat))
    put(client, body(squat))

    assert client.get(ENTRIES, params={"limit": 2}).json()["next_cursor"] is None


def test_cursor_is_stable_when_an_entry_is_added_behind_it(client: TestClient, squat: UUID) -> None:
    """Offset pagination fails this: the new row shifts every position by one."""
    put(client, body(squat, at="2026-11-03T08:00:00Z"))
    newest = put(client, body(squat, at="2026-11-03T12:00:00Z"))
    first = client.get(ENTRIES, params={"limit": 1}).json()
    assert first["items"][0]["id"] == newest["id"]

    put(client, body(squat, at="2026-11-03T20:00:00Z"))
    rest = client.get(ENTRIES, params={"cursor": first["next_cursor"]}).json()

    assert newest["id"] not in [entry["id"] for entry in rest["items"]]
    assert len(rest["items"]) == 1


def test_default_page_is_50(client: TestClient, squat: UUID) -> None:
    for _ in range(51):
        put(client, body(squat))

    page = client.get(ENTRIES).json()

    assert len(page["items"]) == 50
    assert page["next_cursor"] is not None


@pytest.mark.parametrize("cursor", ["junk", "", "!!!", "aGVsbG8=", "YXxifGM="])
def test_bad_cursor_is_invalid(client: TestClient, cursor: str) -> None:
    response = client.get(ENTRIES, params={"cursor": cursor})

    assert error_fields(response) == ["query.cursor"]


@pytest.mark.parametrize("limit", [0, 201])
def test_limit_is_bounded(client: TestClient, limit: int) -> None:
    assert client.get(ENTRIES, params={"limit": limit}).status_code == 422


def test_day_query_params_are_dates(client: TestClient) -> None:
    assert client.get(ENTRIES, params={"from": "not-a-day"}).status_code == 422


# Sessions


def test_sessions_group_sets_by_day_newest_first(client: TestClient, squat: UUID) -> None:
    put(client, body(squat, at="2026-11-02T12:00:00Z", reps=10, weight_lb=100))
    put(client, body(squat, at="2026-11-03T12:10:00Z", reps=4, weight_lb=None))
    put(client, body(squat, at="2026-11-03T12:00:00Z", reps=5, weight_lb=140.5))

    assert sessions(client, squat) == [
        {
            "day": "2026-11-03",
            "sets": [
                {"number": 1, "reps": 5, "weight_lb": 140.5},
                {"number": 2, "reps": 4, "weight_lb": None},
            ],
        },
        {"day": "2026-11-02", "sets": [{"number": 1, "reps": 10, "weight_lb": 100}]},
    ]


def test_session_numbers_match_the_feed(client: TestClient, squat: UUID) -> None:
    # Two share a moment, so the id has to break the tie the same way in both queries.
    moments = ["08:00:00", "12:00:00", "12:00:00", "19:00:00"]
    for reps, at in enumerate(moments, start=1):
        put(client, body(squat, at=f"2026-11-03T{at}Z", reps=reps))

    feed = client.get(ENTRIES).json()["items"]
    expected = sorted((entry["number"], entry["reps"]) for entry in feed)

    sets = sessions(client, squat)[0]["sets"]
    assert [(item["number"], item["reps"]) for item in sets] == expected


def test_limit_counts_sessions_not_sets(client: TestClient, squat: UUID) -> None:
    for day in ("2026-11-01", "2026-11-02", "2026-11-03"):
        put(client, body(squat, at=f"{day}T12:00:00Z"))
        put(client, body(squat, at=f"{day}T12:10:00Z"))

    found = sessions(client, squat, limit=2)

    assert [session["day"] for session in found] == ["2026-11-03", "2026-11-02"]
    assert [len(session["sets"]) for session in found] == [2, 2]


def test_sessions_default_to_the_last_five(client: TestClient, squat: UUID) -> None:
    for day in range(1, DEFAULT_SESSIONS + 3):
        put(client, body(squat, at=f"2026-10-{day:02}T12:00:00Z"))

    assert len(sessions(client, squat)) == DEFAULT_SESSIONS


def test_sessions_hold_only_this_exercise(client: TestClient, squat: UUID) -> None:
    bench = create_exercise(client, "Bench Press")
    put(client, body(squat, reps=5))
    put(client, body(bench, reps=9))

    assert [item["reps"] for item in sessions(client, squat)[0]["sets"]] == [5]


def test_session_days_are_the_users_days_not_utc(client: TestClient, squat: UUID) -> None:
    """Two Sets on one UTC date, but in two local Days, are two Sessions."""
    put(client, body(squat, at="2026-11-04T04:00:00Z", occurred_tz="America/Los_Angeles"))
    put(client, body(squat, at="2026-11-04T20:00:00Z", occurred_tz="America/Los_Angeles"))

    assert [session["day"] for session in sessions(client, squat)] == ["2026-11-04", "2026-11-03"]


def test_a_session_ends_when_its_last_set_is_deleted(client: TestClient, squat: UUID) -> None:
    entry = put(client, body(squat))

    client.delete(entry_url(entry["id"]))

    assert sessions(client, squat) == []


def test_a_never_used_exercise_has_no_sessions(client: TestClient, squat: UUID) -> None:
    assert sessions(client, squat) == []


def test_an_archived_exercise_keeps_its_sessions(client: TestClient, squat: UUID) -> None:
    put(client, body(squat))
    client.patch(f"/api/v1/exercises/{squat}", json={"archived": True})

    assert len(sessions(client, squat)) == 1


def test_sessions_of_a_missing_exercise_are_404(client: TestClient) -> None:
    assert client.get(sessions_url(uuid7())).status_code == 404


def test_sessions_of_another_users_exercise_are_404(
    client: TestClient, session: Session, other_user: UUID
) -> None:
    theirs = foreign_exercise(session, other_user)

    assert client.get(sessions_url(theirs)).status_code == 404


@pytest.mark.parametrize("limit", [0, 201])
def test_session_limit_is_bounded(client: TestClient, squat: UUID, limit: int) -> None:
    assert client.get(sessions_url(squat), params={"limit": limit}).status_code == 422
