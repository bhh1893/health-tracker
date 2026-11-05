"""Alembic's entry point: connects with DATABASE_URL, as role `app` in the cluster."""

from alembic import context

from health_api.db import create_db_engine
from health_api.logs import configure_logging

configure_logging()

engine = create_db_engine()
with engine.connect() as connection:
    context.configure(connection=connection)
    with context.begin_transaction():
        context.run_migrations()
engine.dispose()
