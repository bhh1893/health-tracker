"""Who is calling, from the proxy's headers, on real Postgres (ADR 0021, ADR 0022, ADR 0014)."""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from identities import (
    ISSUER,
    MEMBER_EMAIL,
    MEMBER_HEADERS,
    MEMBER_ID,
    MEMBER_NAME,
    headers,
    insert_member,
    insert_user,
)
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session

from health_api.identity import (
    EMAIL_HEADER,
    ISSUER_HEADER,
    NAME_HEADER,
    SEEDED_USER_ID,
    SUBJECT_HEADER,
    _sign_up,  # pyright: ignore[reportPrivateUsage]
)
from health_api.main import create_app
from health_api.problems import PENDING_APPROVAL, PROBLEM_MEDIA_TYPE, SIGNUP_CLOSED

ME = "/api/me"
FOODS = "/api/v1/foods"


def user_row(session: Session, subject: str) -> dict[str, object] | None:
    row = (
        session.execute(
            text(
                "SELECT id, role, name, email FROM users "
                "WHERE issuer = :issuer AND subject = :subject"
            ),
            {"issuer": ISSUER, "subject": subject},
        )
        .mappings()
        .one_or_none()
    )
    return dict(row) if row else None


# 401: no identity


@pytest.mark.parametrize("path", [ME, FOODS])
def test_no_identity_headers_is_a_401_problem(anonymous_client: TestClient, path: str) -> None:
    response = anonymous_client.get(path)

    assert response.status_code == 401
    assert response.headers["content-type"] == PROBLEM_MEDIA_TYPE
    assert response.json()["status"] == 401


@pytest.mark.parametrize(
    "sent",
    [
        {ISSUER_HEADER: ISSUER},
        {SUBJECT_HEADER: "someone"},
        {ISSUER_HEADER: ISSUER, SUBJECT_HEADER: ""},
        # Name and email are display data: they identify nobody.
        {NAME_HEADER: "Test Member", EMAIL_HEADER: "member@example.test"},
    ],
    ids=["issuer-only", "subject-only", "empty-subject", "name-and-email-only"],
)
def test_half_an_identity_is_a_401(
    anonymous_client: TestClient, session: Session, sent: dict[str, str]
) -> None:
    users_before = session.scalar(text("SELECT count(*) FROM users"))

    assert anonymous_client.get(ME, headers=sent).status_code == 401
    assert session.scalar(text("SELECT count(*) FROM users")) == users_before


# Sign-up and Pending


def test_an_unknown_identity_signs_up_as_pending(
    anonymous_client: TestClient, session: Session
) -> None:
    response = anonymous_client.get(ME, headers=headers("new", "New Person", "new@example.test"))

    assert response.status_code == 200, response.text
    assert response.json() == {
        "role": "pending",
        "name": "New Person",
        "email": "new@example.test",
        "restaurant_day_kcal": 5000,
    }
    row = user_row(session, "new")
    assert row is not None
    assert (row["role"], row["name"], row["email"]) == ("pending", "New Person", "new@example.test")


def test_sign_up_happens_once(anonymous_client: TestClient, session: Session) -> None:
    for _ in range(3):
        anonymous_client.get(ME, headers=headers("new")).raise_for_status()

    count = session.scalar(
        text("SELECT count(*) FROM users WHERE issuer = :issuer AND subject = 'new'"),
        {"issuer": ISSUER},
    )
    assert count == 1


def test_sign_up_without_name_or_email(anonymous_client: TestClient) -> None:
    response = anonymous_client.get(ME, headers=headers("bare"))

    assert (response.json()["name"], response.json()["email"]) == (None, None)


def test_the_loser_of_a_sign_up_race_reads_the_winners_row(session: Session) -> None:
    # Two first requests at once: the other one inserted between this one's lookup and insert.
    winner = insert_user(session, "racer", "pending", "Racer")

    row = _sign_up(session, ISSUER, "racer", "Racer", None)

    assert row["id"] == winner


def test_the_issuer_is_part_of_the_key(anonymous_client: TestClient, session: Session) -> None:
    insert_user(session, "shared-sub", "member")

    response = anonymous_client.get(ME, headers=headers("shared-sub", issuer="https://other.test"))

    # The same `sub` at another provider is another person: a new Pending User.
    assert response.json()["role"] == "pending"


def test_sign_up_never_reaches_the_seeded_user(
    anonymous_client: TestClient, session: Session
) -> None:
    anonymous_client.get(ME, headers=headers("new")).raise_for_status()

    seeded = session.execute(
        text("SELECT issuer, role FROM users WHERE id = :id"), {"id": SEEDED_USER_ID}
    ).one()
    assert tuple(seeded) == (None, "pending")


@pytest.mark.parametrize(
    ("method", "path"),
    [("GET", FOODS), ("GET", "/api/v1/meals"), ("GET", "/api/v1/days"), ("PATCH", ME)],
)
def test_pending_gets_403_pending_approval(
    anonymous_client: TestClient, session: Session, method: str, path: str
) -> None:
    insert_user(session, "waiting", "pending")

    response = anonymous_client.request(method, path, headers=headers("waiting"), json={})

    assert response.status_code == 403
    assert response.headers["content-type"] == PROBLEM_MEDIA_TYPE
    assert response.json()["type"] == PENDING_APPROVAL


@pytest.fixture
def real_client(database_url: str, api_rw_engine: Engine) -> Iterator[TestClient]:
    """The real get_session: what a request commits stays, as in production."""
    with TestClient(create_app()) as client:
        yield client
    with api_rw_engine.begin() as connection:
        connection.execute(
            text("DELETE FROM users WHERE issuer = :issuer AND subject = 'committed'"),
            {"issuer": ISSUER},
        )


def test_sign_up_survives_the_403(real_client: TestClient, api_rw_engine: Engine) -> None:
    # The first request a new person's browser makes may well be a data route, not /api/me.
    assert real_client.get(FOODS, headers=headers("committed")).status_code == 403

    with Session(api_rw_engine) as session:
        row = user_row(session, "committed")
    assert row is not None
    assert row["role"] == "pending"


# The Sign-up brake (ADR 0026)


@pytest.fixture
def closed(session: Session) -> None:
    session.execute(text("UPDATE signup SET open = false"))


@pytest.mark.parametrize("path", [ME, FOODS])
def test_a_closed_brake_turns_away_a_new_identity_and_writes_nothing(
    anonymous_client: TestClient, session: Session, closed: None, path: str
) -> None:
    users_before = session.scalar(text("SELECT count(*) FROM users"))

    response = anonymous_client.get(path, headers=headers("new", "New Person"))

    assert response.status_code == 403
    assert response.headers["content-type"] == PROBLEM_MEDIA_TYPE
    assert response.json()["type"] == SIGNUP_CLOSED
    assert user_row(session, "new") is None
    assert session.scalar(text("SELECT count(*) FROM users")) == users_before


def test_a_closed_brake_still_admits_a_known_pending_user_as_pending(
    anonymous_client: TestClient, session: Session, closed: None
) -> None:
    insert_user(session, "waiting", "pending")

    assert anonymous_client.get(ME, headers=headers("waiting")).json()["role"] == "pending"
    response = anonymous_client.get(FOODS, headers=headers("waiting"))
    assert response.json()["type"] == PENDING_APPROVAL


def test_a_closed_brake_leaves_a_member_unaffected(client: TestClient, closed: None) -> None:
    assert client.get(ME).json()["role"] == "member"
    assert client.get(FOODS).status_code == 200


def test_reopening_the_brake_lets_the_new_identity_sign_up(
    anonymous_client: TestClient, session: Session, closed: None
) -> None:
    assert anonymous_client.get(ME, headers=headers("new")).status_code == 403

    session.execute(text("UPDATE signup SET open = true"))

    assert anonymous_client.get(ME, headers=headers("new")).json()["role"] == "pending"


# Approved Users


@pytest.mark.parametrize("role", ["member", "admin"])
def test_approved_users_reach_data(
    anonymous_client: TestClient, session: Session, role: str
) -> None:
    insert_user(session, "approved", role)

    response = anonymous_client.get(FOODS, headers=headers("approved"))

    assert response.status_code == 200, response.text


def test_the_member_fixture_is_who_the_api_serves(client: TestClient, session: Session) -> None:
    client.put(f"{FOODS}/019a0000-0000-7000-8000-0000000000b1", json={"name": "Oats"})

    owner = session.scalar(text("SELECT user_id FROM foods WHERE name = 'Oats'"))
    assert owner == MEMBER_ID


# Name and email freshness


def users_updated(session: Session) -> int:
    """Postgres's count of `users` rows updated, for comparing within one test.

    Only a difference means anything: on a pooled connection the count can also hold earlier
    transactions' updates not yet flushed to the shared statistics. Inside the test's one open
    transaction nothing flushes, so the count only grows.
    """
    return session.execute(
        text("SELECT n_tup_upd FROM pg_stat_xact_user_tables WHERE relname = 'users'")
    ).scalar_one()


def test_changed_name_and_email_are_stored(client: TestClient, session: Session) -> None:
    updated_before = users_updated(session)
    sent = {**MEMBER_HEADERS, NAME_HEADER: "New Name", EMAIL_HEADER: "new@example.test"}

    assert client.get(ME, headers=sent).json()["name"] == "New Name"
    row = user_row(session, "member")
    assert row is not None
    assert (row["name"], row["email"]) == ("New Name", "new@example.test")
    # Proves the counter test_unchanged_headers_write_nothing relies on does count.
    assert users_updated(session) - updated_before == 1


@pytest.mark.parametrize("dropped", [NAME_HEADER, EMAIL_HEADER])
def test_a_missing_name_or_email_keeps_the_stored_one(
    anonymous_client: TestClient, session: Session, dropped: str
) -> None:
    insert_member(session)
    sent = {k: v for k, v in MEMBER_HEADERS.items() if k != dropped}

    assert anonymous_client.get(ME, headers=sent).json()["name"] == MEMBER_NAME
    row = user_row(session, "member")
    assert row is not None
    assert (row["name"], row["email"]) == (MEMBER_NAME, MEMBER_EMAIL)


def test_unchanged_headers_write_nothing(client: TestClient, session: Session) -> None:
    updated_before = users_updated(session)

    client.get(ME).raise_for_status()
    client.get(FOODS).raise_for_status()

    assert users_updated(session) == updated_before


def test_utf8_names_arrive_intact(anonymous_client: TestClient, session: Session) -> None:
    # The proxy writes claims as raw UTF-8 bytes, which Starlette reads as Latin-1.
    sent = [(k.encode(), v.encode()) for k, v in headers("accented", "Nguyễn Văn Ánh").items()]

    response = anonymous_client.get(ME, headers=sent)

    assert response.json()["name"] == "Nguyễn Văn Ánh"
    row = user_row(session, "accented")
    assert row is not None
    assert row["name"] == "Nguyễn Văn Ánh"
