"""Users for tests, and the headers oauth2-proxy would send for them (ADR 0014).

`TestClient` calls `api` with no proxy in front, so tests set the identity headers themselves.
"""

from uuid import UUID

from sqlalchemy import Connection, text
from sqlalchemy.orm import Session

from health_api.identity import EMAIL_HEADER, ISSUER_HEADER, NAME_HEADER, SUBJECT_HEADER

# Not Google's: a test identity must never match a real one.
ISSUER = "https://issuer.test"

# The Member every `client` request is made as. A fixed id, so helpers that insert rows
# directly can own them by the same User the API serves.
MEMBER_ID = UUID("019a0000-0000-7000-8000-00000000a001")
MEMBER_SUBJECT = "member"
MEMBER_NAME = "Test Member"
MEMBER_EMAIL = "member@example.test"


def headers(
    subject: str, name: str | None = None, email: str | None = None, issuer: str = ISSUER
) -> dict[str, str]:
    sent = {ISSUER_HEADER: issuer, SUBJECT_HEADER: subject}
    if name is not None:
        sent[NAME_HEADER] = name
    if email is not None:
        sent[EMAIL_HEADER] = email
    return sent


MEMBER_HEADERS = headers(MEMBER_SUBJECT, MEMBER_NAME, MEMBER_EMAIL)


def insert_user(
    db: Session | Connection,
    subject: str,
    role: str,
    name: str | None = None,
    email: str | None = None,
    user_id: UUID | None = None,
) -> UUID:
    return db.execute(
        text(
            "INSERT INTO users (id, issuer, subject, role, name, email) "
            "VALUES (COALESCE(CAST(:id AS uuid), uuidv7()), "
            ":issuer, :subject, :role, :name, :email) "
            "RETURNING id"
        ),
        {
            "id": user_id,
            "issuer": ISSUER,
            "subject": subject,
            "role": role,
            "name": name,
            "email": email,
        },
    ).scalar_one()


def insert_member(db: Session | Connection) -> UUID:
    return insert_user(db, MEMBER_SUBJECT, "member", MEMBER_NAME, MEMBER_EMAIL, MEMBER_ID)
