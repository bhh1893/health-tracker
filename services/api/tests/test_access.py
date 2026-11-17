"""The access line: one per request, naming the User, route template and visitor IP (ADR 0030)."""

import json
import logging
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from identities import MEMBER_ID

from health_api.access import AccessLogMiddleware, is_passing_probe
from health_api.logs import JsonFormatter

PHONE_IP = "203.0.113.7"


def access_lines(caplog: pytest.LogCaptureFixture) -> list[dict[str, object]]:
    """Each access record as the JSON line `kubectl logs` would show."""
    formatter = JsonFormatter()
    return [
        json.loads(formatter.format(record))
        for record in caplog.records
        if record.name == "health_api.access"
    ]


def test_line_names_user_template_and_visitor_ip(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    meal_id = uuid4()
    caplog.set_level(logging.INFO, "health_api.access")

    client.get(f"/api/v1/meals/{meal_id}", headers={"CF-Connecting-IP": PHONE_IP})

    [line] = access_lines(caplog)
    assert line["user_id"] == str(MEMBER_ID)
    assert line["method"] == "GET"
    assert line["path"] == "/api/v1/meals/{meal_id}"
    assert line["status"] == 404
    assert line["client_ip"] == PHONE_IP
    # The template, never the filled-in path: no ids or other values in the logs.
    assert str(meal_id) not in json.dumps(line)


def test_no_user_without_identity_headers(
    anonymous_client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO, "health_api.access")

    anonymous_client.get("/api/v1/meals", params={"date": "2026-11-17"})

    [line] = access_lines(caplog)
    assert line["user_id"] is None
    assert line["status"] == 401


def test_x_forwarded_for_is_never_the_visitor_ip(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO, "health_api.access")

    client.get("/api/me", headers={"X-Forwarded-For": PHONE_IP})

    [line] = access_lines(caplog)
    assert line["client_ip"] is None


def test_unmatched_path_is_logged_without_it(caplog: pytest.LogCaptureFixture) -> None:
    app = FastAPI()
    app.add_middleware(AccessLogMiddleware)
    caplog.set_level(logging.INFO, "health_api.access")

    TestClient(app).get("/secret-token-in-path")

    [line] = access_lines(caplog)
    assert line["path"] is None
    assert line["status"] == 404
    assert "secret-token-in-path" not in json.dumps(line)


def test_unhandled_exception_is_logged_as_500(caplog: pytest.LogCaptureFixture) -> None:
    app = FastAPI()
    app.add_middleware(AccessLogMiddleware)

    @app.get("/boom")
    def boom() -> None:  # pyright: ignore[reportUnusedFunction]
        raise RuntimeError("boom")

    caplog.set_level(logging.INFO, "health_api.access")

    TestClient(app, raise_server_exceptions=False).get("/boom")

    [line] = access_lines(caplog)
    assert line["path"] == "/boom"
    assert line["status"] == 500


@pytest.mark.parametrize(
    ("path", "status", "dropped"),
    [
        ("/healthz", 200, True),
        ("/readyz", 200, True),
        ("/readyz", 503, False),
        ("/api/v1/meals", 200, False),
        (None, 404, False),
    ],
)
def test_only_passing_probes_are_dropped(path: str | None, status: int, dropped: bool) -> None:
    assert is_passing_probe(path, status) is dropped
