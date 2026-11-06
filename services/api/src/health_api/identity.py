"""Who is asking. Implicit, the "/me" pattern: no user_id in paths or bodies (ADR 0006)."""

from typing import Annotated
from uuid import UUID

from fastapi import Depends

# Matches the row migration 0001 seeds. The migration keeps its own copy: a migration is a
# frozen record of the past, so it must never import from code that can change.
SEEDED_USER_ID = UUID("019a0000-0000-7000-8000-000000000001")


def current_user() -> UUID:
    """v1 has one user. Real authentication replaces this body and nothing else."""
    return SEEDED_USER_ID


CurrentUser = Annotated[UUID, Depends(current_user)]
