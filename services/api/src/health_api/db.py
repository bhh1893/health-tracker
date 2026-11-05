"""Database access. The only configuration is DATABASE_URL (ADR 0005)."""

import os
from collections.abc import Iterator

from fastapi import Request
from sqlalchemy import URL, Engine, create_engine, make_url
from sqlalchemy.orm import Session


def database_url() -> URL:
    # The env var stays a plain postgresql:// URL that any provider can hand us; choosing
    # the Python driver is this service's concern, so it is set here.
    return make_url(os.environ["DATABASE_URL"]).set(drivername="postgresql+psycopg")


def create_db_engine() -> Engine:
    return create_engine(
        database_url(),
        # Test each pooled connection before use: a failover leaves dead ones behind.
        pool_pre_ping=True,
        # How long to wait for a free pooled connection. The default of 30s outlasts any probe.
        pool_timeout=5,
        connect_args={
            # Opening a new connection. Says nothing about one already open.
            "connect_timeout": 3,
            # An open connection whose node died without closing it: without these two, a
            # request blocks for many minutes, until the kernel gives up on retransmitting.
            # tcp_user_timeout (milliseconds) bounds sent data that is never acknowledged.
            "tcp_user_timeout": 10_000,
            # Keepalives notice the same thing on a connection sitting idle in the pool.
            "keepalives_idle": 10,
            "keepalives_interval": 5,
            "keepalives_count": 2,
        },
    )


def get_session(request: Request) -> Iterator[Session]:
    engine: Engine = request.app.state.engine
    with Session(engine) as session:
        yield session
