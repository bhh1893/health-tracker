import psycopg

from app.db import pool


def test_livez(client):
    assert client.get("/livez").json() == {"status": "ok"}


def test_readyz_is_ready_with_a_database(client):
    r = client.get("/readyz")
    assert r.status_code == 200 and r.json() == {"status": "ready"}


def test_readyz_is_503_when_the_database_is_unreachable(client, monkeypatch):
    def down(*args, **kwargs):
        raise psycopg.OperationalError("database is down")

    monkeypatch.setattr(pool, "connection", down)
    assert client.get("/readyz").status_code == 503
    assert client.get("/livez").status_code == 200  # liveness never touches the database


def test_data_routes_return_503_when_the_database_is_unreachable(client, monkeypatch):
    def down(*args, **kwargs):
        raise psycopg.OperationalError("database is down")

    monkeypatch.setattr(pool, "connection", down)
    r = client.get("/foods")
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "db_unavailable"
