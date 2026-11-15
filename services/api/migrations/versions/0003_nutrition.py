"""Nutrition on Foods, the Restaurant Day value on Users, and Reference Foods (ADR 0023).

Revision ID: 0003
Revises: 0002
"""

from alembic import op

revision = "0003"
down_revision = "0002"

NUTRITION = ("basis_g", "kcal", "protein_g", "carbs_g", "fat_g")
MACROS = ("protein_g", "carbs_g", "fat_g")


def bounds(table: str) -> list[str]:
    """ADR 0023's bounds, shared by `foods` and `reference_foods`.

    A CHECK passes when it evaluates to NULL, so each bound holds whenever its column is set
    and says nothing when it is not. Whether the columns may be unset is decided elsewhere.
    """
    return [
        f"CONSTRAINT {table}_basis_g_positive CHECK (basis_g > 0)",
        f"CONSTRAINT {table}_kcal_range CHECK (kcal BETWEEN 0 AND 10000)",
        *(
            f"CONSTRAINT {table}_{macro}_range CHECK ({macro} BETWEEN 0 AND basis_g)"
            for macro in MACROS
        ),
        f"CONSTRAINT {table}_piece_g_positive CHECK (piece_g > 0)",
    ]


def upgrade() -> None:
    # Expand only: old `api` pods keep serving during the rollout (ADR 0001), and they never
    # name these columns. One ALTER per table, so each table is scanned and locked once.
    op.execute(
        f"""
        ALTER TABLE foods
            {", ".join(f"ADD COLUMN {column} numeric" for column in NUTRITION)},
            ADD COLUMN piece_g numeric,
            -- One rule across five columns, which no single-column CHECK can express.
            -- Piece Weight is left out: a Food can have one without Nutrition, or not.
            ADD CONSTRAINT foods_nutrition_all_or_nothing
                CHECK (num_nonnulls({", ".join(NUTRITION)}) IN (0, 5)),
            {", ".join(f"ADD {constraint}" for constraint in bounds("foods"))}
        """
    )

    # A constant default is stored once in the catalog, so existing rows read 5000 without
    # Postgres rewriting the table (Postgres 11+).
    op.execute(
        """
        ALTER TABLE users
            ADD COLUMN restaurant_day_kcal numeric NOT NULL DEFAULT 5000,
            ADD CONSTRAINT users_restaurant_day_kcal_range
                CHECK (restaurant_day_kcal BETWEEN 0 AND 10000)
        """
    )

    # No user_id: the first table outside ADR 0002's ownership rule. No id default either:
    # every id comes from services/api/data/reference_foods.csv, so a reload can match it.
    op.execute(
        f"""
        CREATE TABLE reference_foods (
            id uuid PRIMARY KEY,
            name text NOT NULL CHECK (btrim(name) <> ''),
            {", ".join(f"{column} numeric NOT NULL" for column in NUTRITION)},
            piece_g numeric,
            {", ".join(bounds("reference_foods"))}
        )
        """
    )
    op.execute(
        "CREATE INDEX reference_foods_name_trgm "
        "ON reference_foods USING gin (lower(name) gin_trgm_ops)"
    )
    # The default privileges from 0001 just granted api_rw full row access. Take writes back:
    # only the owner role `app` loads this table, in the migration Job.
    op.execute("REVOKE INSERT, UPDATE, DELETE ON reference_foods FROM api_rw")


# No downgrade: we roll forward (ADR 0001).
