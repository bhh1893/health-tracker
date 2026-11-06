"""DRILL, to be reverted: fails on purpose in the cluster (#57, ADR 0016).

Proves that a failed PreSync migration stops the sync and the old `api` keeps serving.
CI builds a database with the same roles and name as the cluster, so a plain failure could
never merge. `cluster_name` is the one difference: `pg` under CNPG, empty in CI.

Revision ID: 0003
Revises: 0002
"""

from alembic import op
from sqlalchemy import text

revision = "0003"
down_revision = "0002"


def upgrade() -> None:
    cluster = op.get_bind().scalar(text("SELECT current_setting('cluster_name')"))
    if cluster != "pg":
        return
    # Changes the schema first, to show the failure rolls this back with it.
    op.execute("ALTER TABLE users ADD COLUMN drill_column text")
    raise RuntimeError("deliberate failure: the bad migration drill for #57")
