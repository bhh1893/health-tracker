"""Per-User rate and write limits (ADR 0027, ADR 0030)."""

import json
from collections.abc import Callable, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from identities import ISSUER, MEMBER_HEADERS, MEMBER_SUBJECT, headers, insert_member, insert_user
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session

from health_api.access import CLIENT_IP_HEADER
from health_api.db import get_session
from health_api.main import create_app
from health_api.problems import PROBLEM_MEDIA_TYPE, RATE_LIMITED
from health_api.rate_limits import RATE_LIMIT_ENV, WRITE_RATE_LIMIT_ENV

FOODS = "/api/v1/foods"
FOOD = f"{FOODS}/019a0000-0000-7000-8000-0000000000f1"
# Matches no route, so it touches no database: a cheap way to use up a limit.
NOWHERE = "/api/v1/nowhere"


@pytest.fixture(autouse=True)
def default_limits(monkeypatch: pytest.MonkeyPatch) -> None:
    """ADR 0027's numbers, whatever the shell running the tests has set."""
    monkeypatch.delenv(RATE_LIMIT_ENV, raising=False)
    monkeypatch.delenv(WRITE_RATE_LIMIT_ENV, raising=False)


@pytest.fixture
def limited(
    session: Session, database_url: str, monkeypatch: pytest.MonkeyPatch
) -> Iterator[Callable[[str, str], TestClient]]:
    """A client for an app built with the given limits, as the Member."""
    clients: list[TestClient] = []

    def build(rate: str, write_rate: str) -> TestClient:
        monkeypatch.setenv(RATE_LIMIT_ENV, rate)
        monkeypatch.setenv(WRITE_RATE_LIMIT_ENV, write_rate)
        app = create_app()
        app.dependency_overrides[get_session] = lambda: session
        client = TestClient(app, headers=MEMBER_HEADERS)
        clients.append(client.__enter__())
        return client

    insert_member(session)
    yield build
    for client in clients:
        client.__exit__(None, None, None)


@pytest.fixture
def queries(api_rw_engine: Engine) -> Iterator[list[str]]:
    """Every SQL statement the API sends to Postgres while the test runs."""
    sent: list[str] = []

    def record(*args: Any) -> None:
        sent.append(args[2])  # (connection, cursor, statement, ...)

    event.listen(api_rw_engine, "before_cursor_execute", record)
    yield sent
    event.remove(api_rw_engine, "before_cursor_execute", record)


def assert_rate_limited(response: Any) -> None:
    assert response.status_code == 429, response.text
    assert response.headers["content-type"] == PROBLEM_MEDIA_TYPE
    assert response.json()["type"] == RATE_LIMITED
    assert response.json()["detail"] == "Too many requests. Wait a moment and try again."
    assert 1 <= int(response.headers["retry-after"]) <= 60


# ADR 0027's "verify at build", at the configured numbers


def test_the_301st_request_gets_429_without_a_query(client: TestClient, queries: list[str]) -> None:
    client.get(FOODS).raise_for_status()
    # Proves the listener sees the identity lookup, so the empty list below means something.
    assert queries
    for _ in range(299):
        assert client.get(NOWHERE).status_code == 404
    queries.clear()

    response = client.get(FOODS)

    assert_rate_limited(response)
    assert queries == []


def test_the_61st_write_gets_429_without_a_query(client: TestClient, queries: list[str]) -> None:
    client.put(FOOD, json={"name": "Oats"}).raise_for_status()
    for _ in range(59):
        assert client.delete(NOWHERE).status_code == 404
    queries.clear()

    response = client.put(FOOD, json={"name": "Oats"})

    assert_rate_limited(response)
    assert queries == []
    # The write limit leaves reads alone.
    assert client.get(FOODS).status_code == 200


# What is counted, and against whom


def test_each_user_has_their_own_counter(
    limited: Callable[[str, str], TestClient], session: Session
) -> None:
    client = limited("1/minute", "1/minute")
    insert_user(session, "other", "member")
    client.get(FOODS).raise_for_status()
    assert_rate_limited(client.get(FOODS))

    assert client.get(FOODS, headers=headers("other")).status_code == 200


def test_a_refused_request_uses_up_nothing(limited: Callable[[str, str], TestClient]) -> None:
    client = limited("3/minute", "1/minute")
    client.put(FOOD, json={"name": "Oats"}).raise_for_status()
    assert_rate_limited(client.put(FOOD, json={"name": "Oats"}))

    # 3 allowed in all: the refused write took none of them.
    assert client.get(FOODS).status_code == 200
    assert client.get(FOODS).status_code == 200
    assert_rate_limited(client.get(FOODS))


def test_equal_limits_keep_separate_counters(limited: Callable[[str, str], TestClient]) -> None:
    # If both limits shared one counter, every write would count twice.
    client = limited("2/minute", "2/minute")

    assert client.put(FOOD, json={"name": "Oats"}).status_code in (200, 201)
    assert client.put(FOOD, json={"name": "Oats"}).status_code == 200


@pytest.mark.parametrize("path", ["/healthz", "/readyz"])
def test_probes_are_never_limited(limited: Callable[[str, str], TestClient], path: str) -> None:
    client = limited("1/minute", "1/minute")

    for sent in (MEMBER_HEADERS, {}):
        for _ in range(3):
            assert client.get(path, headers=sent).status_code == 200


def test_no_identity_is_401_not_429(limited: Callable[[str, str], TestClient]) -> None:
    client = limited("1/minute", "1/minute")
    client.headers.clear()

    for _ in range(3):
        assert client.get(FOODS).status_code == 401


# Seeing it, and configuring it


def test_a_429_is_logged_with_the_user_and_visitor_ip(
    limited: Callable[[str, str], TestClient], capsys: pytest.CaptureFixture[str]
) -> None:
    client = limited("1/minute", "1/minute")
    client.get(FOODS).raise_for_status()
    capsys.readouterr()

    client.get(FOODS, headers={CLIENT_IP_HEADER: "203.0.113.7"})

    # The JSON line kubectl logs shows. Not caplog: create_app's logging setup replaces the
    # root handlers, pytest's capture handler included.
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    [entry] = [line for line in lines if line["logger"] == "health_api.rate_limits"]
    assert entry["level"] == "WARNING"
    assert f"issuer={ISSUER} subject={MEMBER_SUBJECT}" in entry["message"]
    assert entry["message"].endswith("from 203.0.113.7")
    # The limit sits inside the access log, so a refused request still gets its line. No User
    # id or route on it: both come after the limit, which answered first.
    [access] = [line for line in lines if line["logger"] == "health_api.access"]
    assert (access["status"], access["client_ip"]) == (429, "203.0.113.7")


@pytest.mark.parametrize("env", [RATE_LIMIT_ENV, WRITE_RATE_LIMIT_ENV])
def test_a_bad_limit_fails_at_boot(monkeypatch: pytest.MonkeyPatch, env: str) -> None:
    monkeypatch.setenv(env, "lots")

    with pytest.raises(ValueError, match=env):
        create_app()
