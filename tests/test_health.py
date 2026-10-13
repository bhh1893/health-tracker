from fastapi.testclient import TestClient

from app.main import app

# No `with` block, so the lifespan (pool.open) does not run: these tests need no database.
client = TestClient(app)


def test_livez_is_ok():
    assert client.get("/livez").status_code == 200


def test_readyz_is_503_without_database():
    assert client.get("/readyz").status_code == 503
