import secrets
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from migrate import alembic_upgrade, plain_url
from sqlalchemy import URL, Engine, create_engine, text
from sqlalchemy.orm import Session
from testcontainers.community.postgres import PostgresContainer

from health_api.db import get_session
from health_api.main import create_app

POSTGRES_IMAGE = "postgres:18.6"


@pytest.fixture(scope="session")
def postgres() -> Iterator[URL]:
    """A Postgres server, as a URL for its superuser."""
    password = secrets.token_hex(16)
    with PostgresContainer(POSTGRES_IMAGE, username="postgres", password=password) as container:
        yield URL.create(
            "postgresql+psycopg",
            username="postgres",
            password=password,
            host=container.get_container_host_ip(),
            port=int(container.get_exposed_port(5432)),
            database="postgres",
        )


@pytest.fixture(scope="session")
def role_urls(postgres: URL) -> dict[str, URL]:
    """Roles shaped like the cluster's (ADR 0015): `app` owns `health` but is no superuser."""
    urls: dict[str, URL] = {}
    superuser = create_engine(postgres, isolation_level="AUTOCOMMIT")
    with superuser.connect() as connection:
        for role in ("app", "api_rw"):
            password = secrets.token_hex(16)
            connection.execute(text(f"CREATE ROLE {role} LOGIN PASSWORD '{password}'"))
            urls[role] = postgres.set(username=role, password=password, database="health")
        connection.execute(text("CREATE DATABASE health OWNER app"))
    superuser.dispose()
    return urls


@pytest.fixture(scope="session")
def migrated(role_urls: dict[str, URL]) -> None:
    alembic_upgrade(role_urls["app"])


@pytest.fixture(scope="session")
def api_rw_engine(role_urls: dict[str, URL], migrated: None) -> Iterator[Engine]:
    engine = create_engine(role_urls["api_rw"])
    yield engine
    engine.dispose()


@pytest.fixture(scope="session")
def owner_engine(role_urls: dict[str, URL], migrated: None) -> Iterator[Engine]:
    engine = create_engine(role_urls["app"])
    yield engine
    engine.dispose()


@pytest.fixture
def session(api_rw_engine: Engine) -> Iterator[Session]:
    """A session whose work vanishes after the test.

    The outer transaction is never committed. `create_savepoint` turns any commit made by
    code under test into a savepoint inside it, so the final rollback undoes that too.
    """
    with api_rw_engine.connect() as connection:
        transaction = connection.begin()
        with Session(connection, join_transaction_mode="create_savepoint") as test_session:
            yield test_session
        transaction.rollback()


@pytest.fixture
def owner_session(owner_engine: Engine) -> Iterator[Session]:
    """`session`, but as the owner `app`: for tables api_rw may only read."""
    with owner_engine.connect() as connection:
        transaction = connection.begin()
        with Session(connection) as test_session:
            yield test_session
        transaction.rollback()


@pytest.fixture
def database_url(role_urls: dict[str, URL], migrated: None, monkeypatch: pytest.MonkeyPatch) -> str:
    """Points the service at the test database as api_rw, as `db-api` does in the cluster."""
    url = plain_url(role_urls["api_rw"])
    monkeypatch.setenv("DATABASE_URL", url)
    return url


@pytest.fixture
def empty_database(postgres: URL, role_urls: dict[str, URL]) -> Iterator[dict[str, URL]]:
    """A database with no migrations, for states `health` can never be in. Role URLs for it."""
    superuser = create_engine(postgres, isolation_level="AUTOCOMMIT")
    with superuser.connect() as connection:
        connection.execute(text("CREATE DATABASE empty OWNER app"))
    yield {role: url.set(database="empty") for role, url in role_urls.items()}
    with superuser.connect() as connection:
        connection.execute(text("DROP DATABASE empty WITH (FORCE)"))
    superuser.dispose()


@pytest.fixture
def client(session: Session, database_url: str) -> Iterator[TestClient]:
    app = create_app()
    app.dependency_overrides[get_session] = lambda: session
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def committing_client(database_url: str, api_rw_engine: Engine) -> Iterator[TestClient]:
    """The real get_session, so each request has its own session, as in production.

    `client` shares one session between requests, so a later request can read work that was
    never committed. A write route's test needs this fixture to prove that its work survives.
    These rows are real commits, and tests that expect empty tables share this database.
    """
    with TestClient(create_app()) as test_client:
        yield test_client
    with api_rw_engine.begin() as connection:
        # Entries first: their foreign keys restrict deleting a Catalog item in use.
        for table in ("meals", "exercise_entries", "foods", "exercises", "restaurants"):
            connection.execute(text(f"DELETE FROM {table}"))
