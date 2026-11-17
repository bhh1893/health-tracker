"""The calling User's own settings (ADR 0021, ADR 0023).

Outside /api/v1 on purpose, as the ADRs name it: /api/me is the one route a Pending User may
call (ADR 0021), so it sits beside the versioned resources, not among them.
"""

from uuid import UUID

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from health_api.catalogs import MAX_KCAL
from health_api.db import DbSession
from health_api.identity import (
    NOT_APPROVED,
    SIGNUP_CLOSED_RESPONSE,
    UNAUTHENTICATED,
    CurrentUser,
    Role,
    SignedInUser,
)


class Me(BaseModel):
    # `web` branches on it: Pending shows "Waiting for approval" (ADR 0021).
    role: Role
    # From the identity provider, for display. Null if the provider sent none.
    name: str | None
    # The caller's own address, shown so they can tell which account they used. Display
    # only, never used for lookup (ADR 0022). Null if the provider never sent one.
    email: str | None
    # What every Restaurant Day counts as, whatever else was logged on it (ADR 0023).
    restaurant_day_kcal: float


class PatchMe(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # The column is never null, so null here can only mean "leave it", like a field left out.
    restaurant_day_kcal: float | None = Field(
        default=None, ge=0, le=MAX_KCAL, allow_inf_nan=False, strict=True
    )


def load_me(session: Session, user: UUID) -> Me:
    row = (
        session.execute(
            text("SELECT role, name, email, restaurant_day_kcal FROM users WHERE id = :user"),
            {"user": user},
        )
        .mappings()
        .one()
    )
    return Me(
        role=row["role"],
        name=row["name"],
        email=row["email"],
        restaurant_day_kcal=float(row["restaurant_day_kcal"]),
    )


def me_router() -> APIRouter:
    router = APIRouter(prefix="/api/me", tags=["me"], responses=UNAUTHENTICATED)

    @router.get(
        "",
        operation_id="get_me",
        response_model=Me,
        responses=SIGNUP_CLOSED_RESPONSE,
        description="Read the calling User's Role and settings. The one route open to Pending.",
    )
    def get_me(user: SignedInUser, session: DbSession) -> Me:
        return load_me(session, user.id)

    @router.patch(
        "",
        operation_id="patch_me",
        response_model=Me,
        responses=NOT_APPROVED,
        description="Change the calling User's settings, such as the Restaurant Day calories.",
    )
    def patch_me(body: PatchMe, user: CurrentUser, session: DbSession) -> Me:
        if body.restaurant_day_kcal is not None:
            # Nothing is recomputed here: Day totals read this value on every request, so
            # the change reaches every past Restaurant Day at once (ADR 0023).
            session.execute(
                text("UPDATE users SET restaurant_day_kcal = :kcal WHERE id = :user"),
                {"kcal": body.restaurant_day_kcal, "user": user},
            )
        me = load_me(session, user)
        session.commit()
        return me

    return router
