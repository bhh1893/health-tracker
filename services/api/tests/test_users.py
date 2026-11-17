"""Users, Roles and the users command on real Postgres, as api_rw (ADR 0022)."""

from collections.abc import Callable
from itertools import count
from typing import Any
from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, ProgrammingError
from sqlalchemy.orm import Session

from health_api.identity import SEEDED_USER_ID
from health_api.users import (
    Refused,
    change_role,
    claim_seeded,
    list_users,
    load_brake,
    main,
    set_signup,
)

CHECK_VIOLATION = "23514"
UNIQUE_VIOLATION = "23505"
INSUFFICIENT_PRIVILEGE = "42501"
GOOGLE = "https://accounts.google.com"

subjects = count(1)


def add_user(session: Session, role: str = "pending", **values: Any) -> UUID:
    """A signed-up User: a fresh Google identity unless the test says otherwise."""
    subject = str(next(subjects))
    row = {
        "issuer": GOOGLE,
        "subject": subject,
        "name": f"Person {subject}",
        "email": f"person{subject}@example.com",
        "role": role,
        **values,
    }
    columns = ", ".join(row)
    placeholders = ", ".join(f":{column}" for column in row)
    return session.execute(
        text(f"INSERT INTO users ({columns}) VALUES ({placeholders}) RETURNING id"), row
    ).scalar_one()


def role_of(session: Session, user: UUID) -> str:
    return session.execute(text("SELECT role FROM users WHERE id = :id"), {"id": user}).scalar_one()


def changes(session: Session) -> list[tuple[Any, ...]]:
    rows = session.execute(
        text("SELECT user_id, from_role, to_role, reason FROM role_changes ORDER BY changed_at, id")
    )
    return [tuple(row) for row in rows]


def yes() -> bool:
    return True


def no() -> bool:
    return False


def sqlstate(error: Exception) -> str | None:
    return getattr(getattr(error, "orig", None), "sqlstate", None)


def constraint(error: IntegrityError) -> str | None:
    return getattr(getattr(error.orig, "diag", None), "constraint_name", None)


# --- Schema -------------------------------------------------------------------------------


def test_the_seeded_user_has_no_identity_and_is_pending(session: Session) -> None:
    row = session.execute(
        text("SELECT role, issuer, subject, name, email FROM users WHERE id = :id"),
        {"id": SEEDED_USER_ID},
    ).one()

    assert tuple(row) == ("pending", None, None, None, None)


def test_a_new_user_starts_pending(session: Session) -> None:
    user = session.execute(text("INSERT INTO users DEFAULT VALUES RETURNING id")).scalar_one()

    assert role_of(session, user) == "pending"


@pytest.mark.parametrize(
    ("values", "name"),
    [
        ({"role": "owner"}, "users_role_known"),
        ({"subject": None}, "users_identity_both_or_neither"),
        ({"issuer": None}, "users_identity_both_or_neither"),
    ],
)
def test_postgres_refuses_a_bad_user(session: Session, values: dict[str, Any], name: str) -> None:
    with pytest.raises(IntegrityError) as caught:
        add_user(session, **values)

    assert sqlstate(caught.value) == CHECK_VIOLATION
    assert constraint(caught.value) == name


def test_one_identity_is_one_user(session: Session) -> None:
    add_user(session, subject="same")

    with pytest.raises(IntegrityError) as caught:
        add_user(session, subject="same")

    assert sqlstate(caught.value) == UNIQUE_VIOLATION
    assert constraint(caught.value) == "users_issuer_subject_key"


def test_the_same_subject_at_another_issuer_is_another_user(session: Session) -> None:
    add_user(session, subject="same")
    add_user(session, subject="same", issuer="https://login.example.com")


def test_many_users_may_have_no_identity(session: Session) -> None:
    session.execute(text("INSERT INTO users DEFAULT VALUES"))
    session.execute(text("INSERT INTO users DEFAULT VALUES"))


@pytest.mark.parametrize(
    ("column", "value"),
    [("from_role", "owner"), ("to_role", "owner"), ("reason", "promote")],
)
def test_postgres_refuses_a_bad_role_change(session: Session, column: str, value: str) -> None:
    row = {"user_id": SEEDED_USER_ID, "from_role": "pending", "to_role": "member"}
    row = {**row, "reason": "approve", column: value}

    with pytest.raises(IntegrityError) as caught:
        session.execute(
            text(
                "INSERT INTO role_changes (user_id, from_role, to_role, reason) "
                "VALUES (:user_id, :from_role, :to_role, :reason)"
            ),
            row,
        )

    assert sqlstate(caught.value) == CHECK_VIOLATION


@pytest.mark.parametrize(
    "statement", ["UPDATE role_changes SET reason = 'approve'", "DELETE FROM role_changes"]
)
def test_api_rw_cannot_rewrite_history(session: Session, statement: str) -> None:
    with pytest.raises(ProgrammingError) as caught:
        session.execute(text(statement))

    assert sqlstate(caught.value) == INSUFFICIENT_PRIVILEGE


# --- list ---------------------------------------------------------------------------------


def test_list_shows_pending_users_first(session: Session) -> None:
    member = add_user(session, role="member")
    pending = add_user(session)

    listed = [user.id for user in list_users(session)]

    # The seeded User is Pending too, and older.
    assert listed == [SEEDED_USER_ID, pending, member]


# --- approve and set-role -----------------------------------------------------------------


def test_approve_makes_a_pending_user_a_member_and_records_it(session: Session) -> None:
    user = add_user(session)

    assert change_role(session, user, "member", "approve", yes)

    assert role_of(session, user) == "member"
    assert changes(session) == [(user, "pending", "member", "approve")]


@pytest.mark.parametrize("role", ["member", "admin"])
def test_approve_refuses_a_user_who_is_not_pending(session: Session, role: str) -> None:
    user = add_user(session, role=role)

    with pytest.raises(Refused, match="Pending to Member only"):
        change_role(session, user, "member", "approve", yes)


def test_saying_no_writes_nothing(session: Session) -> None:
    user = add_user(session)

    assert not change_role(session, user, "member", "approve", no)

    assert role_of(session, user) == "pending"
    assert changes(session) == []


def test_the_command_shows_the_row_before_and_after(
    session: Session, capsys: pytest.CaptureFixture[str]
) -> None:
    user = add_user(session, name="Ann", email="ann@example.com")

    change_role(session, user, "member", "approve", no)

    before, after = capsys.readouterr().out.splitlines()
    assert before.startswith(f"before: {user}  pending  Ann  <ann@example.com>")
    assert after.startswith(f"after:  {user}  member   Ann  <ann@example.com>")


@pytest.mark.parametrize(
    ("start", "to"),
    [
        ("member", "pending"),
        ("member", "admin"),
        ("pending", "admin"),
    ],
)
def test_set_role_makes_any_change(session: Session, start: str, to: str) -> None:
    user = add_user(session, role=start)

    assert change_role(session, user, to, "set-role", yes)

    assert role_of(session, user) == to
    assert changes(session) == [(user, start, to, "set-role")]


def test_set_role_refuses_a_change_to_the_same_role(session: Session) -> None:
    user = add_user(session, role="member")

    with pytest.raises(Refused, match="already member"):
        change_role(session, user, "member", "set-role", yes)


def test_set_role_refuses_an_unknown_role(session: Session) -> None:
    user = add_user(session)

    with pytest.raises(Refused, match="unknown Role"):
        change_role(session, user, "owner", "set-role", yes)


def test_set_role_refuses_to_remove_the_last_admin(session: Session) -> None:
    admin = add_user(session, role="admin")

    with pytest.raises(Refused, match="last Admin"):
        change_role(session, admin, "member", "set-role", yes)

    assert role_of(session, admin) == "admin"


def test_set_role_may_demote_an_admin_while_another_remains(session: Session) -> None:
    admin = add_user(session, role="admin")
    add_user(session, role="admin")

    assert change_role(session, admin, "member", "set-role", yes)


def test_an_unknown_user_is_refused(session: Session) -> None:
    with pytest.raises(Refused, match="no User"):
        change_role(session, UUID(int=1), "member", "approve", yes)


def test_a_change_made_while_asking_is_not_overwritten(session: Session) -> None:
    """Someone else approves the User while the prompt is open: the command must notice."""
    user = add_user(session)

    def approved_elsewhere() -> bool:
        session.execute(text("UPDATE users SET role = 'member' WHERE id = :id"), {"id": user})
        return True

    with pytest.raises(Refused):
        change_role(session, user, "member", "approve", approved_elsewhere)

    assert changes(session) == []


def test_the_last_admin_rule_is_checked_again_after_asking(session: Session) -> None:
    """Two Admins, each demoted by its own run: the second to apply must refuse."""
    first = add_user(session, role="admin")
    second = add_user(session, role="admin")

    def other_run_demotes_second() -> bool:
        session.execute(text("UPDATE users SET role = 'member' WHERE id = :id"), {"id": second})
        return True

    with pytest.raises(Refused, match="last Admin"):
        change_role(session, first, "member", "set-role", other_run_demotes_second)

    assert role_of(session, first) == "admin"


# --- claim-seeded -------------------------------------------------------------------------


def test_claim_seeded_moves_the_identity_and_makes_the_seeded_user_admin(
    session: Session,
) -> None:
    owner = add_user(session, subject="owner-sub", name="Owner", email="owner@example.com")

    assert claim_seeded(session, owner, yes)

    seeded = session.execute(
        text("SELECT role, issuer, subject, name, email FROM users WHERE id = :id"),
        {"id": SEEDED_USER_ID},
    ).one()
    assert tuple(seeded) == ("admin", GOOGLE, "owner-sub", "Owner", "owner@example.com")
    gone = session.scalar(text("SELECT count(*) FROM users WHERE id = :id"), {"id": owner})
    assert gone == 0
    assert changes(session) == [(SEEDED_USER_ID, "pending", "admin", "claim-seeded")]


def test_claim_seeded_keeps_the_seeded_users_history(session: Session) -> None:
    session.execute(
        text("INSERT INTO foods (user_id, name) VALUES (:id, 'Oats')"), {"id": SEEDED_USER_ID}
    )
    owner = add_user(session)

    claim_seeded(session, owner, yes)

    foods = session.scalar(
        text("SELECT count(*) FROM foods WHERE user_id = :id"), {"id": SEEDED_USER_ID}
    )
    assert foods == 1


def test_claim_seeded_refuses_once_the_seeded_user_has_an_identity(session: Session) -> None:
    claim_seeded(session, add_user(session), yes)

    with pytest.raises(Refused, match="already has an identity"):
        claim_seeded(session, add_user(session), yes)


def test_claim_seeded_refuses_the_seeded_user_itself(session: Session) -> None:
    with pytest.raises(Refused, match="not the seeded User"):
        claim_seeded(session, SEEDED_USER_ID, yes)


def test_claim_seeded_refuses_a_target_who_is_not_pending(session: Session) -> None:
    with pytest.raises(Refused, match="must be Pending"):
        claim_seeded(session, add_user(session, role="member"), yes)


def test_claim_seeded_refuses_a_target_with_no_identity(session: Session) -> None:
    target = add_user(session, issuer=None, subject=None)

    with pytest.raises(Refused, match="no identity"):
        claim_seeded(session, target, yes)


OwnsSomething = Callable[[Session, UUID], None]


def owns_food(session: Session, user: UUID) -> None:
    session.execute(text("INSERT INTO foods (user_id, name) VALUES (:id, 'Oats')"), {"id": user})


def owns_role_change(session: Session, user: UUID) -> None:
    """Approved once and then set back to Pending: history the delete would lose."""
    change_role(session, user, "member", "approve", yes)
    change_role(session, user, "pending", "set-role", yes)


@pytest.mark.parametrize(
    ("owns", "table"), [(owns_food, "foods"), (owns_role_change, "role_changes")]
)
def test_claim_seeded_refuses_a_target_who_owns_rows(
    session: Session, owns: OwnsSomething, table: str
) -> None:
    target = add_user(session)
    owns(session, target)

    with pytest.raises(Refused, match=f"owns rows in {table}"):
        claim_seeded(session, target, yes)


def test_saying_no_to_claim_seeded_writes_nothing(session: Session) -> None:
    target = add_user(session)

    assert not claim_seeded(session, target, no)

    assert role_of(session, SEEDED_USER_ID) == "pending"
    assert role_of(session, target) == "pending"


# --- The Sign-up brake (ADR 0026) ----------------------------------------------------------


def test_a_fresh_install_starts_open(session: Session) -> None:
    assert load_brake(session, lock=False).open


@pytest.mark.parametrize(
    "statement",
    [
        "INSERT INTO signup (id, open) VALUES (false, false)",
        "INSERT INTO signup (open) VALUES (false)",
    ],
    ids=["a-second-key", "the-same-key"],
)
def test_the_brake_is_one_row(owner_session: Session, statement: str) -> None:
    """As the owner: api_rw may not insert at all, which the next test shows."""
    with pytest.raises(IntegrityError):
        owner_session.execute(text(statement))


@pytest.mark.parametrize(
    "statement", ["DELETE FROM signup", "INSERT INTO signup (open) VALUES (false)"]
)
def test_api_rw_cannot_remove_or_add_the_brake_row(session: Session, statement: str) -> None:
    with pytest.raises(ProgrammingError) as caught:
        session.execute(text(statement))

    assert sqlstate(caught.value) == INSUFFICIENT_PRIVILEGE


def test_close_then_open(session: Session) -> None:
    opened_at = load_brake(session, lock=False).changed_at

    assert set_signup(session, False, yes)
    closed = load_brake(session, lock=False)
    assert not closed.open
    assert closed.changed_at > opened_at

    assert set_signup(session, True, yes)
    assert load_brake(session, lock=False).open


def test_saying_no_leaves_the_brake_alone(session: Session) -> None:
    assert not set_signup(session, False, no)

    assert load_brake(session, lock=False).open


def test_closing_a_closed_brake_is_refused(session: Session) -> None:
    set_signup(session, False, yes)

    with pytest.raises(Refused, match="already closed"):
        set_signup(session, False, yes)


def test_close_shows_the_brake_before_and_after(
    session: Session, capsys: pytest.CaptureFixture[str]
) -> None:
    set_signup(session, False, no)

    before, after = capsys.readouterr().out.splitlines()
    assert before.startswith("before: Sign-up open since ")
    assert after == "after:  Sign-up closed"


def test_a_brake_change_made_while_asking_is_not_overwritten(session: Session) -> None:
    def someone_else_closes_and_reopens() -> bool:
        session.execute(text("UPDATE signup SET open = false"))
        session.execute(text("UPDATE signup SET open = true, changed_at = now() + interval '1 s'"))
        return True

    with pytest.raises(Refused, match="changed since it was shown"):
        set_signup(session, False, someone_else_closes_and_reopens)


# --- The command line -----------------------------------------------------------------------


def test_list_runs_as_api_rw_from_database_url(
    database_url: str, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["list"]) == 0

    header, seeded = capsys.readouterr().out.splitlines()[:2]
    assert header.startswith("Sign-up open since ")
    assert seeded.startswith(f"{SEEDED_USER_ID}  pending  -  <->  no identity")


def test_no_answer_is_no(
    database_url: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    def no_stdin(prompt: str) -> str:
        raise EOFError

    monkeypatch.setattr("builtins.input", no_stdin)

    assert main(["approve", str(SEEDED_USER_ID)]) == 1
    assert capsys.readouterr().out.endswith("nothing changed\n")


def test_a_refusal_exits_non_zero(database_url: str, capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["set-role", str(SEEDED_USER_ID), "pending"]) == 1
    assert "refused: this User is already pending" in capsys.readouterr().err


def test_signup_status_prints_the_brake(
    database_url: str, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["signup", "status"]) == 0

    assert capsys.readouterr().out.startswith("Sign-up open since ")


@pytest.mark.parametrize(
    "argv",
    [
        [],
        ["approve", "not-a-uuid"],
        ["set-role", str(SEEDED_USER_ID), "owner"],
        ["signup"],
        ["signup", "shut"],
    ],
)
def test_bad_arguments_stop_before_connecting(argv: list[str]) -> None:
    """No database_url fixture: reaching the database would fail with KeyError instead."""
    with pytest.raises(SystemExit) as caught:
        main(argv)

    assert caught.value.code == 2
