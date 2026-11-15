"""Runs migrations as the cluster does, for conftest and for tests that stop at a revision."""

import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy import URL

SERVICE_DIR = Path(__file__).resolve().parents[1]


def plain_url(url: URL) -> str:
    """DATABASE_URL as the cluster's Secrets hold it: no driver name, real password."""
    return url.set(drivername="postgresql").render_as_string(hide_password=False)


def alembic_upgrade(owner_url: URL, revision: str = "head") -> None:
    """Migrates the way the migration Job does: the real command, as the owner role."""
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", revision],
        cwd=SERVICE_DIR,
        env={**os.environ, "DATABASE_URL": plain_url(owner_url)},
        check=True,
    )
