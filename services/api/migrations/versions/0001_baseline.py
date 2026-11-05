"""Baseline: grants for api_rw, the users table, and the single seeded user.

Revision ID: 0001
Revises:
"""

from alembic import op

revision = "0001"
down_revision = None

SEEDED_USER_ID = "019a0000-0000-7000-8000-000000000001"


def upgrade() -> None:
    # Before any table: covers every table `app` creates from now on, here and in later
    # migrations, so a new table can never ship without grants (ADR 0015).
    op.execute(
        "ALTER DEFAULT PRIVILEGES IN SCHEMA public "
        "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO api_rw"
    )
    # alembic_version already exists, so the line above misses it. /readyz only reads it.
    op.execute("GRANT SELECT ON alembic_version TO api_rw")

    op.execute(
        """
        CREATE TABLE users (
            id uuid PRIMARY KEY DEFAULT uuidv7(),
            created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(f"INSERT INTO users (id) VALUES ('{SEEDED_USER_ID}')")


# No downgrade: we roll forward (ADR 0001).
