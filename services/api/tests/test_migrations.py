import pytest
from migrate import alembic_upgrade
from sqlalchemy import URL, Engine, create_engine, text
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import Session

from health_api.migrations import image_revisions

INSUFFICIENT_PRIVILEGE = "42501"


def test_migrations_have_one_head() -> None:
    """Two branches merged without a merge migration would leave `upgrade head` ambiguous."""
    heads, _ = image_revisions()

    assert len(heads) == 1


def test_baseline_seeds_exactly_one_user(session: Session) -> None:
    assert session.scalar(text("SELECT count(*) FROM users")) == 1


def test_api_rw_can_read_and_write_rows(session: Session) -> None:
    session.execute(text("INSERT INTO users DEFAULT VALUES"))
    session.execute(text("UPDATE users SET created_at = now()"))
    session.execute(text("DELETE FROM users"))

    assert session.scalar(text("SELECT count(*) FROM users")) == 0


@pytest.mark.parametrize(
    "statement",
    [
        "DROP TABLE users",
        "ALTER TABLE users ADD COLUMN sneaky text",
        "CREATE TABLE sneaky (id int)",
        "TRUNCATE users",
        "UPDATE alembic_version SET version_num = 'sneaky'",
    ],
)
def test_api_rw_cannot_change_the_schema(api_rw_engine: Engine, statement: str) -> None:
    with api_rw_engine.connect() as connection, pytest.raises(ProgrammingError) as caught:
        connection.execute(text(statement))

    assert getattr(caught.value.orig, "sqlstate", None) == INSUFFICIENT_PRIVILEGE


@pytest.mark.parametrize(
    ("privilege", "expected"),
    [
        ("SELECT", True),
        ("INSERT", True),
        ("UPDATE", True),
        ("DELETE", True),
        ("TRUNCATE", False),
    ],
)
def test_tables_created_later_get_exactly_the_row_grants(
    owner_engine: Engine, privilege: str, expected: bool
) -> None:
    """One privilege per check: given a list, has_table_privilege passes if any one is held."""
    with owner_engine.connect() as connection:
        transaction = connection.begin()
        connection.execute(text("CREATE TABLE future_table (id int)"))
        granted = connection.scalar(
            text("SELECT has_table_privilege('api_rw', 'future_table', :privilege)"),
            {"privilege": privilege},
        )
        transaction.rollback()

    assert granted is expected


@pytest.mark.parametrize("run", [1, 2])
def test_each_test_starts_clean(session: Session, run: int) -> None:
    """Runs twice: if the first run's insert leaked, the second one's count would be 2."""
    assert session.scalar(text("SELECT count(*) FROM users")) == 1
    session.execute(text("INSERT INTO users DEFAULT VALUES"))
    session.commit()


def test_nutrition_migration_keeps_existing_rows(empty_database: dict[str, URL]) -> None:
    """Rows from before 0003 survive it: Foods without Nutrition, Users at the default."""
    alembic_upgrade(empty_database["app"], "0002")
    owner = create_engine(empty_database["app"])
    with owner.begin() as connection:
        connection.execute(text("INSERT INTO foods (user_id, name) SELECT id, 'Rice' FROM users"))

    alembic_upgrade(empty_database["app"])

    with owner.connect() as connection:
        food = connection.execute(
            text("SELECT basis_g, kcal, protein_g, carbs_g, fat_g, piece_g FROM foods")
        ).one()
        restaurant_day_kcal = connection.scalar(text("SELECT restaurant_day_kcal FROM users"))
    owner.dispose()

    assert tuple(food) == (None,) * 6
    assert restaurant_day_kcal == 5000


def test_meal_restaurants_migration_backfills_every_restaurant_meal(
    empty_database: dict[str, URL],
) -> None:
    """Each Restaurant Meal from before 0006 gets its one row; a foods Meal gets none."""
    alembic_upgrade(empty_database["app"], "0005")
    owner = create_engine(empty_database["app"])
    with owner.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO restaurants (user_id, name) SELECT id, 'Diner' FROM users;
                INSERT INTO meals (user_id, kind, restaurant_id, occurred_at, occurred_tz, day)
                SELECT user_id, 'restaurant', id, now(), 'UTC', current_date FROM restaurants;
                INSERT INTO meals (user_id, kind, occurred_at, occurred_tz, day)
                SELECT id, 'foods', now(), 'UTC', current_date FROM users;
                """
            )
        )

    alembic_upgrade(empty_database["app"])

    with owner.connect() as connection:
        copied = (
            connection.execute(
                text(
                    """
                SELECT m.restaurant_id = mr.restaurant_id AND m.user_id = mr.user_id
                FROM meal_restaurants mr JOIN meals m ON m.id = mr.meal_id
                """
                )
            )
            .scalars()
            .all()
        )
    owner.dispose()

    assert copied == [True]


def test_restaurant_category_migration_makes_every_restaurant_ate_out(
    empty_database: dict[str, URL],
) -> None:
    """Restaurants from before 0007 read as ate out, with no backfill to run (ADR 0041)."""
    alembic_upgrade(empty_database["app"], "0006")
    owner = create_engine(empty_database["app"])
    with owner.begin() as connection:
        connection.execute(
            text("INSERT INTO restaurants (user_id, name) SELECT id, 'Diner' FROM users")
        )

    alembic_upgrade(empty_database["app"])

    with owner.connect() as connection:
        categories = connection.execute(text("SELECT category FROM restaurants")).scalars().all()
    owner.dispose()

    assert categories == ["ate_out"]
