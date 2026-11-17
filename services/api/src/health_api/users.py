"""The owner's command for Users, Roles and the Sign-up brake (ADR 0022, ADR 0026).

Runs inside an `api` pod through `iac/scripts/users`, with the pod's own DATABASE_URL, so it
connects as `api_rw` and can change rows but not the schema. Every Role change writes a
`role_changes` row in the same transaction.

Each write runs in two phases. First it checks the rules, shows the row before and after, and
asks. Only then does it lock the rows, check the rules again and compare with what was shown,
so no lock is held while a person reads the prompt.
"""

import argparse
import sys
from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace
from datetime import datetime
from uuid import UUID

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from health_api.db import database_url
from health_api.identity import SEEDED_USER_ID

ROLES = ("pending", "member", "admin")

# Tables whose rows point straight at a User. Entries need a Catalog item or a Meal, so a
# User with none of these owns nothing. If a new table is missed here, the RESTRICT foreign
# key still refuses the delete; this list only lets the command refuse before it asks.
OWNED_TABLES = ("foods", "exercises", "restaurants", "meals", "role_changes")

Confirm = Callable[[], bool]


class Refused(Exception):
    """The change breaks a rule. Nothing was written."""


@dataclass(frozen=True)
class User:
    id: UUID
    role: str
    issuer: str | None
    subject: str | None
    name: str | None
    email: str | None
    created_at: datetime

    def describe(self) -> str:
        identity = "no identity" if self.issuer is None else f"{self.issuer} {self.subject}"
        return (
            f"{self.id}  {self.role:<7}  {self.name or '-'}  <{self.email or '-'}>  "
            f"{identity}  created {self.created_at:%Y-%m-%d %H:%M %Z}"
        )


USER_COLUMNS = "id, role, issuer, subject, name, email, created_at"


def load_user(session: Session, user_id: UUID, lock: bool) -> User:
    row = (
        session.execute(
            text(f"SELECT {USER_COLUMNS} FROM users WHERE id = :id{' FOR UPDATE' if lock else ''}"),
            {"id": user_id},
        )
        .mappings()
        .one_or_none()
    )
    if row is None:
        raise Refused(f"no User {user_id}")
    return User(**row)


def list_users(session: Session) -> list[User]:
    """Pending first: they are the ones waiting on the Admin."""
    rows = session.execute(
        text(f"SELECT {USER_COLUMNS} FROM users ORDER BY role <> 'pending', created_at, id")
    ).mappings()
    return [User(**row) for row in rows]


@dataclass(frozen=True)
class Brake:
    open: bool
    changed_at: datetime

    @property
    def state(self) -> str:
        return "open" if self.open else "closed"

    def describe(self) -> str:
        return f"Sign-up {self.state} since {self.changed_at:%Y-%m-%d %H:%M %Z}"


def load_brake(session: Session, lock: bool) -> Brake:
    row = (
        session.execute(text(f"SELECT open, changed_at FROM signup{' FOR UPDATE' if lock else ''}"))
        .mappings()
        .one()
    )
    return Brake(**row)


def set_signup(session: Session, open: bool, confirm: Confirm) -> bool:
    """`signup open` and `signup close`. True if the change was written.

    Known Users never read the brake, so closing it stops only new identities (ADR 0026).
    """
    before = load_brake(session, lock=False)
    if before.open == open:
        raise Refused(f"Sign-up is already {before.state}")
    session.commit()

    print(f"before: {before.describe()}")
    print(f"after:  Sign-up {'open' if open else 'closed'}")
    if not confirm():
        return False

    if load_brake(session, lock=True) != before:
        raise Refused("Sign-up changed since it was shown; run the command again")
    session.execute(text("UPDATE signup SET open = :open, changed_at = now()"), {"open": open})
    session.commit()
    return True


def check_role_change(
    session: Session, user_id: UUID, to_role: str, reason: str, lock: bool
) -> User:
    """The rules for `approve` and `set-role`. Returns the User as it is now."""
    user = load_user(session, user_id, lock)
    if reason == "approve" and user.role != "pending":
        raise Refused(f"approve changes Pending to Member only; this User is {user.role}")
    if user.role == to_role:
        raise Refused(f"this User is already {to_role}")
    if user.role == "admin":
        # Locking every Admin row makes two demotions run one after the other, so they
        # cannot both see two Admins and leave none.
        admins = session.execute(
            text(f"SELECT id FROM users WHERE role = 'admin'{' FOR UPDATE' if lock else ''}")
        ).all()
        if len(admins) == 1:
            raise Refused("this is the last Admin; make another User Admin first")
    return user


def change_role(
    session: Session, user_id: UUID, to_role: str, reason: str, confirm: Confirm
) -> bool:
    """`approve` and `set-role`. True if the change was written."""
    if to_role not in ROLES:
        raise Refused(f"unknown Role {to_role!r}; expected one of {', '.join(ROLES)}")
    before = check_role_change(session, user_id, to_role, reason, lock=False)
    # Ends the read. It wrote nothing, so this holds no lock and no transaction while asking.
    session.commit()

    print(f"before: {before.describe()}")
    print(f"after:  {replace(before, role=to_role).describe()}")
    if not confirm():
        return False

    current = check_role_change(session, user_id, to_role, reason, lock=True)
    if current != before:
        raise Refused("the User changed since it was shown; run the command again")
    session.execute(
        text("UPDATE users SET role = :role WHERE id = :id"), {"role": to_role, "id": user_id}
    )
    record_change(session, user_id, before.role, to_role, reason)
    session.commit()
    return True


def check_claim(session: Session, target_id: UUID, lock: bool) -> tuple[User, User]:
    """The rules for `claim-seeded`. Returns the seeded User and the target, as they are now.

    The seeded User is always read first, so two runs lock rows in the same order.
    """
    seeded = load_user(session, SEEDED_USER_ID, lock)
    if seeded.issuer is not None:
        raise Refused("the seeded User already has an identity")
    if target_id == SEEDED_USER_ID:
        raise Refused("give the Pending User to move onto the seeded User, not the seeded User")
    target = load_user(session, target_id, lock)
    if target.role != "pending":
        raise Refused(f"the target must be Pending; it is {target.role}")
    if target.issuer is None:
        raise Refused("the target has no identity to move")
    owned = [
        table
        for table in OWNED_TABLES
        if session.scalar(
            text(f"SELECT EXISTS (SELECT 1 FROM {table} WHERE user_id = :id)"), {"id": target_id}
        )
    ]
    if owned:
        raise Refused(f"the target owns rows in {', '.join(owned)}")
    return seeded, target


def claim_seeded(session: Session, target_id: UUID, confirm: Confirm) -> bool:
    """Moves a Pending User's identity onto the seeded User and makes it Admin.

    This is how the owner's Google account takes over the history logged before sign-in
    existed. True if the change was written.
    """
    before_seeded, before_target = check_claim(session, target_id, lock=False)
    session.commit()

    after = replace(
        before_seeded,
        role="admin",
        issuer=before_target.issuer,
        subject=before_target.subject,
        name=before_target.name,
        email=before_target.email,
    )
    print(f"before: {before_seeded.describe()}")
    print(f"        {before_target.describe()}")
    print(f"after:  {after.describe()}")
    print(f"        {before_target.id} deleted")
    if not confirm():
        return False

    if check_claim(session, target_id, lock=True) != (before_seeded, before_target):
        raise Refused("a User changed since it was shown; run the command again")
    # Delete first: the identity may exist on one row only (users_issuer_subject_key).
    session.execute(text("DELETE FROM users WHERE id = :id"), {"id": target_id})
    session.execute(
        text(
            "UPDATE users SET role = 'admin', issuer = :issuer, subject = :subject, "
            "name = :name, email = :email WHERE id = :id"
        ),
        {
            "issuer": after.issuer,
            "subject": after.subject,
            "name": after.name,
            "email": after.email,
            "id": SEEDED_USER_ID,
        },
    )
    record_change(session, SEEDED_USER_ID, before_seeded.role, "admin", "claim-seeded")
    session.commit()
    return True


def record_change(
    session: Session, user_id: UUID, from_role: str, to_role: str, reason: str
) -> None:
    session.execute(
        text(
            "INSERT INTO role_changes (user_id, from_role, to_role, reason) "
            "VALUES (:user_id, :from_role, :to_role, :reason)"
        ),
        {"user_id": user_id, "from_role": from_role, "to_role": to_role, "reason": reason},
    )


def ask() -> bool:
    try:
        return input("Apply? [y/N] ").strip().lower() in ("y", "yes")
    # No stdin, e.g. `kubectl exec` without -i: nobody said yes.
    except EOFError:
        return False


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(
        prog="users", description="Users, Roles and the Sign-up brake (ADR 0022, ADR 0026)."
    )
    commands = root.add_subparsers(dest="command", required=True)
    commands.add_parser("list", help="the Sign-up brake, then every User, Pending first")
    approve = commands.add_parser("approve", help="Pending to Member")
    approve.add_argument("user_id", type=UUID)
    set_role = commands.add_parser("set-role", help="any Role change but removing the last Admin")
    set_role.add_argument("user_id", type=UUID)
    set_role.add_argument("role", choices=ROLES)
    claim = commands.add_parser(
        "claim-seeded", help="move a Pending User's identity onto the seeded User, as Admin"
    )
    claim.add_argument("user_id", type=UUID)
    signup = commands.add_parser("signup", help="close, open or show the Sign-up brake")
    signup.add_argument("action", choices=("close", "open", "status"))
    return root


def run(session: Session, args: argparse.Namespace, confirm: Confirm) -> int:
    try:
        match args.command:
            case "list":
                # The brake's state is not in git, so the command most often run shows it.
                print(load_brake(session, lock=False).describe())
                for user in list_users(session):
                    print(user.describe())
                return 0
            case "approve":
                done = change_role(session, args.user_id, "member", "approve", confirm)
            case "set-role":
                done = change_role(session, args.user_id, args.role, "set-role", confirm)
            case "claim-seeded":
                done = claim_seeded(session, args.user_id, confirm)
            case _:
                if args.action == "status":
                    print(load_brake(session, lock=False).describe())
                    return 0
                done = set_signup(session, args.action == "open", confirm)
    except Refused as refusal:
        print(f"refused: {refusal}", file=sys.stderr)
        return 1
    print("done" if done else "nothing changed")
    return 0 if done else 1


def main(argv: Sequence[str] | None = None) -> int:
    args = parser().parse_args(argv)
    engine = create_engine(database_url())
    try:
        with Session(engine) as session:
            return run(session, args, ask)
    finally:
        engine.dispose()


if __name__ == "__main__":
    sys.exit(main())
