"""Every Restaurant has a Category: ate out, drinks or dessert (ADR 0041).

One step, no contract: the column only adds, so a pod still on the old code keeps working. It
never writes the column, and the default fills it in.

Revision ID: 0007
Revises: 0006
"""

from alembic import op

revision = "0007"
down_revision = "0006"


def upgrade() -> None:
    # A constant default is stored once in the catalog, not written to every row (Postgres 11+),
    # so no row is rewritten and every existing Restaurant reads as ate out. The new CHECK still
    # costs one read of the table to verify, which a Catalog of hundreds of rows a User makes
    # cheap. A CHECK on text, not an enum type: a new value is one ordinary migration.
    op.execute(
        """
        ALTER TABLE restaurants
            ADD COLUMN category text NOT NULL DEFAULT 'ate_out'
                CONSTRAINT restaurants_category_check
                CHECK (category IN ('ate_out', 'drinks', 'dessert'))
        """
    )


# No downgrade: we roll forward (ADR 0001).
