"""The User's own settings on real Postgres (ADR 0023)."""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from identities import MEMBER_EMAIL, MEMBER_ID, MEMBER_NAME
from sqlalchemy import text
from sqlalchemy.orm import Session

ME = "/api/me"
MEMBER = {"role": "member", "name": MEMBER_NAME, "email": MEMBER_EMAIL}


def kcal_of(response: Any) -> float:
    return response.json()["restaurant_day_kcal"]


def test_restaurant_day_kcal_starts_at_the_default(client: TestClient) -> None:
    response = client.get(ME)

    assert response.status_code == 200, response.text
    assert response.json() == {**MEMBER, "restaurant_day_kcal": 5000}


@pytest.mark.parametrize("kcal", [0, 3200.5, 10_000])
def test_patch_changes_restaurant_day_kcal(client: TestClient, kcal: float) -> None:
    patched = client.patch(ME, json={"restaurant_day_kcal": kcal})

    assert patched.status_code == 200, patched.text
    assert patched.json() == {**MEMBER, "restaurant_day_kcal": kcal}
    assert client.get(ME).json() == {**MEMBER, "restaurant_day_kcal": kcal}


@pytest.mark.parametrize("body", [{}, {"restaurant_day_kcal": None}])
def test_a_patch_that_sends_nothing_changes_nothing(
    client: TestClient, body: dict[str, Any]
) -> None:
    client.patch(ME, json={"restaurant_day_kcal": 4000})

    assert kcal_of(client.patch(ME, json=body)) == 4000


@pytest.mark.parametrize("kcal", [-1, 10_001, "5000", True])
def test_restaurant_day_kcal_is_bounded(client: TestClient, kcal: Any) -> None:
    response = client.patch(ME, json={"restaurant_day_kcal": kcal})

    assert response.status_code == 422
    assert [error["field"] for error in response.json()["errors"]] == ["body.restaurant_day_kcal"]
    assert kcal_of(client.get(ME)) == 5000


def test_unknown_settings_are_refused(client: TestClient) -> None:
    # Role is read-only here: only the owner's command changes it (ADR 0022).
    assert client.patch(ME, json={"role": "admin"}).status_code == 422


def test_patch_changes_only_the_caller(client: TestClient, session: Session) -> None:
    other = session.execute(text("INSERT INTO users DEFAULT VALUES RETURNING id")).scalar_one()

    client.patch(ME, json={"restaurant_day_kcal": 3000})

    stored = dict(
        session.execute(
            text("SELECT id, restaurant_day_kcal FROM users WHERE id IN (:member, :other)"),
            {"member": MEMBER_ID, "other": other},
        ).all()
    )
    assert stored == {MEMBER_ID: 3000, other: 5000}


def test_patch_commits(committing_client: TestClient) -> None:
    committing_client.patch(ME, json={"restaurant_day_kcal": 3000}).raise_for_status()

    assert kcal_of(committing_client.get(ME)) == 3000
