import os
from pathlib import Path
from uuid import uuid4

import psycopg
import pytest
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict

ADMIN_URL = os.environ.get(
    "HT_ADMIN_DATABASE_URL", "postgresql://health:health@localhost:5432/postgres"
)
TEST_URL = os.environ.get(
    "HT_TEST_DATABASE_URL", "postgresql://health:health@localhost:5432/health_test"
)
TEST_DB = conninfo_to_dict(TEST_URL)["dbname"]
assert TEST_DB.endswith("_test"), "tests TRUNCATE tables: refusing to run on a database not named *_test"

# The app builds its settings and connection pool when it is imported, so point it
# at the test database BEFORE anything imports `app`.
os.environ["HT_DATABASE_URL"] = TEST_URL

from fastapi.testclient import TestClient  # noqa: E402

from app.db import pool  # noqa: E402
from app.main import app  # noqa: E402

MIGRATIONS = sorted((Path(__file__).resolve().parents[1] / "db" / "migrations").glob("*.sql"))


def _up_section(text: str) -> str:
    return text.split("-- migrate:up", 1)[1].split("-- migrate:down", 1)[0]


@pytest.fixture(scope="session", autouse=True)
def database():
    """Create a fresh test database and apply every migration's 'up' section, like dbmate does."""
    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        admin.execute(sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(TEST_DB)))
        admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(TEST_DB)))
    with psycopg.connect(TEST_URL) as conn:
        for path in MIGRATIONS:
            conn.execute(_up_section(path.read_text()))


@pytest.fixture(scope="session")
def client(database):
    # Entering the client runs the app's lifespan, which opens the connection pool.
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def clean_tables(client):
    """Every test starts from empty tables."""
    with pool.connection() as conn:
        conn.execute("TRUNCATE foods, exercises, meal_days, workouts CASCADE")


@pytest.fixture
def uid():
    return lambda: str(uuid4())


@pytest.fixture
def make_food(client):
    def make(name="chicken breast", basis="per_100g", calories=165, protein_g=31, fat_g=3.6, carbs_g=0):
        r = client.post(
            "/foods",
            json={"name": name, "basis": basis, "calories": calories,
                  "protein_g": protein_g, "fat_g": fat_g, "carbs_g": carbs_g},
        )
        assert r.status_code == 201, r.text
        return r.json()

    return make


@pytest.fixture
def make_exercise(client):
    def make(name="bench press", muscle_area=None):
        r = client.post("/exercises", json={"name": name, "muscle_area": muscle_area})
        assert r.status_code == 201, r.text
        return r.json()

    return make


@pytest.fixture
def make_workout(client, uid):
    def make(started_at="2026-10-12T18:00:00-07:00", **extra):
        r = client.post("/workouts", json={"id": uid(), "started_at": started_at, **extra})
        assert r.status_code == 201, r.text
        return r.json()

    return make
