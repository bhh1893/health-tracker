"""Compares the database's Alembic revision with the migrations shipped in this image."""

from functools import cache
from pathlib import Path

from alembic.script import ScriptDirectory
from psycopg.errors import UndefinedTable
from sqlalchemy import Connection, text
from sqlalchemy.exc import ProgrammingError

MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "migrations"


def revision_is_ready(
    db_revision: str | None, heads: frozenset[str], known: frozenset[str]
) -> bool:
    """Is a database at db_revision new enough for an image whose latest revisions are heads?

    A revision this image has never heard of is newer than the image. That is normal during
    a rollout: the migration Job runs first, and old pods keep serving against the expanded
    schema (ADR 0016). Treating it as not ready would take them out of service mid-deploy.
    """
    if db_revision is None:
        return False
    return db_revision in heads or db_revision not in known


@cache
def image_revisions() -> tuple[frozenset[str], frozenset[str]]:
    """The latest revisions in this image, and every revision it knows about."""
    script = ScriptDirectory(str(MIGRATIONS_DIR))
    known = frozenset(revision.revision for revision in script.walk_revisions())
    return frozenset(script.get_heads()), known


def database_revision(connection: Connection) -> str | None:
    try:
        return connection.scalar(text("SELECT version_num FROM alembic_version"))
    except ProgrammingError as error:
        # Alembic creates this table on its first run, so no table means never migrated.
        # Anything else, such as a missing grant, is a different problem and must surface.
        if isinstance(error.orig, UndefinedTable):
            return None
        raise


def schema_is_ready(connection: Connection) -> bool:
    heads, known = image_revisions()
    return revision_is_ready(database_revision(connection), heads, known)
