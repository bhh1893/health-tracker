"""Who is asking, from the headers oauth2-proxy sets (ADR 0021, ADR 0022).

Implicit, the "/me" pattern: no user_id in paths or bodies (ADR 0006). The proxy deletes any
copy of these headers a client sent before adding its own, and uvicorn listens only on
127.0.0.1, so a request that reaches here carries the proxy's values and nobody else's.
"""

from dataclasses import dataclass
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import Depends, Request
from sqlalchemy import RowMapping, text
from sqlalchemy.orm import Session

from health_api.db import DbSession
from health_api.problems import PENDING_APPROVAL, Problem, ProblemError

# Matches the row migration 0001 seeds. The migration keeps its own copy: a migration is a
# frozen record of the past, so it must never import from code that can change.
SEEDED_USER_ID = UUID("019a0000-0000-7000-8000-000000000001")

# Set by oauth2-proxy from the ID token's claims (k8s/components/auth-proxy/alpha-config.yaml).
ISSUER_HEADER = "X-Auth-Issuer"
SUBJECT_HEADER = "X-Auth-Subject"
NAME_HEADER = "X-Auth-Name"
EMAIL_HEADER = "X-Auth-Email"

Role = Literal["pending", "member", "admin"]

# Declared on the routes so the contract tells the truth. In production the proxy answers a
# request with no session itself, so this 401 fires only if something ever skips the proxy.
UNAUTHENTICATED: dict[int | str, dict[str, Any]] = {
    401: {"model": Problem, "description": "No signed-in User."},
}
NOT_APPROVED: dict[int | str, dict[str, Any]] = {
    403: {"model": Problem, "description": "The User is Pending until the Admin approves them."},
}


@dataclass(frozen=True)
class User:
    id: UUID
    role: Role
    name: str | None


def _header(request: Request, name: str) -> str | None:
    """A header as the proxy sent it, or None if absent or empty.

    Starlette reads header bytes as Latin-1, the HTTP default. The proxy sends claims as UTF-8,
    so a name like "Nguyễn" arrives garbled unless the bytes are read again as UTF-8.
    """
    raw = request.headers.get(name)
    if not raw:
        return None
    return raw.encode("latin-1").decode("utf-8", errors="replace")


def _find(session: Session, issuer: str, subject: str) -> RowMapping | None:
    return (
        session.execute(
            text(
                "SELECT id, role, name, email FROM users "
                "WHERE issuer = :issuer AND subject = :subject"
            ),
            {"issuer": issuer, "subject": subject},
        )
        .mappings()
        .one_or_none()
    )


def _sign_up(
    session: Session, issuer: str, subject: str, name: str | None, email: str | None
) -> RowMapping:
    # Two first requests can race: a page load sends several API calls at once. ON CONFLICT
    # makes the loser insert nothing instead of failing on users_issuer_subject_key, and it
    # then reads the winner's row. Role comes from the column default, Pending (ADR 0022).
    session.execute(
        text(
            "INSERT INTO users (issuer, subject, name, email) "
            "VALUES (:issuer, :subject, :name, :email) "
            "ON CONFLICT (issuer, subject) DO NOTHING"
        ),
        {"issuer": issuer, "subject": subject, "name": name, "email": email},
    )
    row = _find(session, issuer, subject)
    assert row is not None, "the insert or the race winner left a row"
    return row


def signed_in_user(request: Request, session: DbSession) -> User:
    """Any signed-in User, Pending included. Only `GET /api/me` uses it directly (ADR 0021)."""
    issuer = _header(request, ISSUER_HEADER)
    subject = _header(request, SUBJECT_HEADER)
    if issuer is None or subject is None:
        # No fallback to the seeded User: that would hand the owner's data to anyone who
        # found a way around the proxy.
        raise ProblemError(401, type="about:blank", detail="Sign in first.")
    name = _header(request, NAME_HEADER)
    email = _header(request, EMAIL_HEADER)

    row = _find(session, issuer, subject)
    if row is None:
        # This insert is Sign-up. Committed here, not by the route: a Pending User's request
        # ends in 403 below, and the row must outlive it.
        row = _sign_up(session, issuer, subject, name, email)
        session.commit()
        return User(id=row["id"], role=row["role"], name=row["name"])

    # Display data only, never used for lookup. A header that is missing keeps what is
    # stored: a claim that stops arriving is far likelier a proxy config slip than a person
    # with no name. Compared here first, so a normal request writes nothing.
    name = name if name is not None else row["name"]
    email = email if email is not None else row["email"]
    if (row["name"], row["email"]) != (name, email):
        session.execute(
            text(
                "UPDATE users SET name = :name, email = :email WHERE id = :id "
                # Repeated so a concurrent request that already wrote it writes nothing.
                "AND (name IS DISTINCT FROM :name OR email IS DISTINCT FROM :email)"
            ),
            {"id": row["id"], "name": name, "email": email},
        )
        session.commit()
    return User(id=row["id"], role=row["role"], name=name)


SignedInUser = Annotated[User, Depends(signed_in_user)]


def current_user(user: SignedInUser) -> UUID:
    """The caller's User id, which scopes every query. A Pending User stops here."""
    if user.role == "pending":
        raise ProblemError(403, type=PENDING_APPROVAL, detail="Waiting for the Admin's approval.")
    return user.id


CurrentUser = Annotated[UUID, Depends(current_user)]
