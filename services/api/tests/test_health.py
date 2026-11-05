import pytest
from fastapi.testclient import TestClient
from sqlalchemy import URL, create_engine, text

from health_api.main import create_app
from health_api.migrations import revision_is_ready
from health_api.problems import PROBLEM_MEDIA_TYPE

NOWHERE = "postgresql://nobody@127.0.0.1:1/nothing"
CREATE_VERSION_TABLE = "CREATE TABLE alembic_version (version_num varchar(32) NOT NULL)"
GRANT_VERSION_TABLE = "GRANT SELECT ON alembic_version TO api_rw"
NOT_MIGRATED = "Database migrations have not been applied."


def test_healthz_stays_up_while_the_database_is_down(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", NOWHERE)

    with TestClient(create_app()) as client:
        response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_readyz_passes_on_a_migrated_database(client: TestClient) -> None:
    response = client.get("/readyz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_readyz_through_the_real_engine(database_url: str) -> None:
    """No overrides: DATABASE_URL, the engine and the api_rw grants all have to work."""
    with TestClient(create_app()) as client:
        assert client.get("/readyz").status_code == 200


def test_readyz_is_503_when_the_database_is_unreachable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", NOWHERE)

    with TestClient(create_app()) as client:
        response = client.get("/readyz")

    assert response.status_code == 503
    assert response.headers["content-type"] == PROBLEM_MEDIA_TYPE
    assert response.json()["detail"] == "Could not connect to the database."


@pytest.mark.parametrize(
    ("setup", "status", "detail"),
    [
        pytest.param([], 503, NOT_MIGRATED, id="never-migrated"),
        pytest.param(
            [CREATE_VERSION_TABLE, GRANT_VERSION_TABLE], 503, NOT_MIGRATED, id="no-revision-row"
        ),
        pytest.param(
            [
                CREATE_VERSION_TABLE,
                GRANT_VERSION_TABLE,
                "INSERT INTO alembic_version VALUES ('from_a_newer_image')",
            ],
            200,
            None,
            id="ahead-of-this-image",
        ),
        pytest.param(
            [CREATE_VERSION_TABLE],
            503,
            "Connected, but the readiness query failed.",
            id="missing-grant",
        ),
    ],
)
def test_readyz_on_a_real_database_as_api_rw(
    empty_database: dict[str, URL],
    monkeypatch: pytest.MonkeyPatch,
    setup: list[str],
    status: int,
    detail: str | None,
) -> None:
    owner = create_engine(empty_database["app"])
    with owner.begin() as connection:
        for statement in setup:
            connection.execute(text(statement))
    owner.dispose()
    monkeypatch.setenv(
        "DATABASE_URL", empty_database["api_rw"].render_as_string(hide_password=False)
    )

    with TestClient(create_app()) as client:
        response = client.get("/readyz")

    assert response.status_code == status
    assert response.json().get("detail") == detail


def test_revision_is_ready_at_head() -> None:
    assert revision_is_ready("b", heads=frozenset({"b"}), known=frozenset({"a", "b"}))


def test_revision_is_not_ready_when_behind_the_image() -> None:
    assert not revision_is_ready("a", heads=frozenset({"b"}), known=frozenset({"a", "b"}))


def test_revision_is_not_ready_on_an_unmigrated_database() -> None:
    assert not revision_is_ready(None, heads=frozenset({"b"}), known=frozenset({"a", "b"}))


def test_old_pods_stay_ready_after_a_newer_migration() -> None:
    assert revision_is_ready("c", heads=frozenset({"b"}), known=frozenset({"a", "b"}))
