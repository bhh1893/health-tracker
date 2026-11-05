import pytest
from sqlalchemy import Engine, text
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
