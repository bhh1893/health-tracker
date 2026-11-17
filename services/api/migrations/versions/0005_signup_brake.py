"""The Sign-up brake: one row saying whether new Users may sign up (ADR 0026).

Revision ID: 0005
Revises: 0004
"""

from alembic import op

revision = "0005"
down_revision = "0004"


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE signup (
            -- Only one value passes the CHECK, and the primary key allows it once, so the
            -- table can never hold a second row that disagrees with the first.
            id boolean PRIMARY KEY DEFAULT true CHECK (id),
            open boolean NOT NULL,
            changed_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    # Open, so a fresh install lets its first User sign up with no extra step.
    op.execute("INSERT INTO signup (open) VALUES (true)")
    # Migration 0001's default privileges granted every row privilege. The command only
    # flips the row, so take back the two that could remove it or add a second.
    op.execute("REVOKE INSERT, DELETE ON signup FROM api_rw")


# No downgrade: we roll forward (ADR 0001).
