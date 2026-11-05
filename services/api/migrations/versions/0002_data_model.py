"""The v1 data model: Catalogs, Meals, Entries, and their indexes (ADR 0002, ADR 0012).

Revision ID: 0002
Revises: 0001
"""

from alembic import op

revision = "0002"
down_revision = "0001"

CATALOGS = ("foods", "exercises", "restaurants")


def upgrade() -> None:
    # A trusted extension: `app` can create it as database owner, without being a superuser.
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    for table in CATALOGS:
        op.execute(
            f"""
            CREATE TABLE {table} (
                id uuid PRIMARY KEY DEFAULT uuidv7(),
                user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
                name text NOT NULL CHECK (btrim(name) <> ''),
                archived_at timestamptz,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                -- Redundant as a uniqueness rule, since id alone is unique. It exists so
                -- children can point at (id, user_id), which is what forces same-owner links.
                UNIQUE (id, user_id)
            )
            """
        )
        # Archived rows are included on purpose: the API offers to unarchive instead.
        op.execute(f"CREATE UNIQUE INDEX {table}_user_name_key ON {table} (user_id, lower(name))")
        op.execute(
            f"CREATE INDEX {table}_name_trgm ON {table} USING gin (lower(name) gin_trgm_ops)"
        )

    op.execute(
        """
        CREATE TABLE meals (
            id uuid PRIMARY KEY DEFAULT uuidv7(),
            user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
            kind text NOT NULL CHECK (kind IN ('foods', 'restaurant')),
            restaurant_id uuid,
            label text,
            occurred_at timestamptz NOT NULL,
            occurred_tz text NOT NULL,
            day date NOT NULL,
            logged_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (id, user_id),
            -- Lets food_entries reference a Meal's kind, not only the Meal.
            UNIQUE (id, kind),
            CONSTRAINT meals_restaurant_matches_kind
                CHECK ((kind = 'restaurant') = (restaurant_id IS NOT NULL)),
            FOREIGN KEY (restaurant_id, user_id) REFERENCES restaurants (id, user_id)
                ON DELETE RESTRICT
        )
        """
    )
    op.execute("CREATE INDEX meals_user_day ON meals (user_id, day, occurred_at, id)")

    op.execute(
        """
        CREATE TABLE food_entries (
            id uuid PRIMARY KEY DEFAULT uuidv7(),
            user_id uuid NOT NULL,
            meal_id uuid NOT NULL,
            -- Always 'foods'. Stored only so the second Meal FK below can compare it with
            -- meals.kind: a FK can match columns, not a constant.
            meal_kind text NOT NULL DEFAULT 'foods' CHECK (meal_kind = 'foods'),
            food_id uuid NOT NULL,
            quantity numeric NOT NULL CHECK (quantity > 0),
            unit text NOT NULL CHECK (unit IN ('g', 'count')),
            logged_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            -- Both Meal FKs must cascade: a RESTRICT on either would block the Meal delete.
            FOREIGN KEY (meal_id, user_id) REFERENCES meals (id, user_id) ON DELETE CASCADE,
            FOREIGN KEY (meal_id, meal_kind) REFERENCES meals (id, kind) ON DELETE CASCADE,
            FOREIGN KEY (food_id, user_id) REFERENCES foods (id, user_id) ON DELETE RESTRICT
        )
        """
    )
    op.execute("CREATE INDEX food_entries_meal ON food_entries (meal_id)")
    op.execute(
        "CREATE INDEX food_entries_user_food ON food_entries (user_id, food_id) INCLUDE (meal_id)"
    )

    op.execute(
        """
        CREATE TABLE exercise_entries (
            id uuid PRIMARY KEY DEFAULT uuidv7(),
            user_id uuid NOT NULL,
            exercise_id uuid NOT NULL,
            reps integer NOT NULL CHECK (reps > 0),
            -- NULL is pure bodyweight, so 0 is rejected: one meaning, one representation.
            weight_lb numeric CHECK (weight_lb > 0),
            occurred_at timestamptz NOT NULL,
            occurred_tz text NOT NULL,
            day date NOT NULL,
            logged_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            FOREIGN KEY (exercise_id, user_id) REFERENCES exercises (id, user_id)
                ON DELETE RESTRICT
        )
        """
    )
    op.execute(
        "CREATE INDEX exercise_entries_user_day ON exercise_entries (user_id, day, occurred_at, id)"
    )
    op.execute(
        "CREATE INDEX exercise_entries_user_exercise_day "
        "ON exercise_entries (user_id, exercise_id, day, occurred_at, id)"
    )


# No downgrade: we roll forward (ADR 0001).
