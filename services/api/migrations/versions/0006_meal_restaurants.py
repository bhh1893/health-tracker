"""Restaurant Meals hold one to ten Restaurants: the expand step (ADR 0034).

Creates `meal_restaurants` and copies every `meals.restaurant_id` into it. The column and its
CHECK stay until a later migration, once no running `api` reads them: during a rollout an old
pod still reads the column, and the new code keeps writing the first Restaurant to it.

Revision ID: 0006
Revises: 0005
"""

from alembic import op

revision = "0006"
down_revision = "0005"


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE meal_restaurants (
            -- UUIDv7 ids are monotonic within a connection, so ORDER BY id is the order the
            -- API inserted them in, which is the order the client sent (ADR 0034).
            id uuid PRIMARY KEY DEFAULT uuidv7(),
            user_id uuid NOT NULL,
            meal_id uuid NOT NULL,
            -- Always 'restaurant', as food_entries.meal_kind is always 'foods': the second
            -- Meal FK compares it with meals.kind, so a foods Meal cannot hold a Restaurant.
            meal_kind text NOT NULL DEFAULT 'restaurant' CHECK (meal_kind = 'restaurant'),
            restaurant_id uuid NOT NULL,
            logged_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            -- A Restaurant once per Meal. Its index, led by meal_id, is also how a Meal's
            -- Restaurants are found, so meal_id needs no index of its own.
            UNIQUE (meal_id, restaurant_id),
            -- Both Meal FKs cascade, for the reason given on food_entries in 0002.
            FOREIGN KEY (meal_id, user_id) REFERENCES meals (id, user_id) ON DELETE CASCADE,
            FOREIGN KEY (meal_id, meal_kind) REFERENCES meals (id, kind) ON DELETE CASCADE,
            FOREIGN KEY (restaurant_id, user_id) REFERENCES restaurants (id, user_id)
                ON DELETE RESTRICT
        )
        """
    )
    # Recent Restaurants and GET /meal-days?q= start from a Restaurant and look for its Meals.
    op.execute(
        "CREATE INDEX meal_restaurants_user_restaurant "
        "ON meal_restaurants (user_id, restaurant_id) INCLUDE (meal_id)"
    )
    # The backfill. One row per Meal, so there is no order within a Meal to keep yet.
    op.execute(
        """
        INSERT INTO meal_restaurants (user_id, meal_id, restaurant_id, logged_at, updated_at)
        SELECT user_id, id, restaurant_id, logged_at, updated_at
        FROM meals
        WHERE restaurant_id IS NOT NULL
        """
    )


# No downgrade: we roll forward (ADR 0001).
