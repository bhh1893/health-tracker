"""What Meals and Exercise Entries share: when they happened, and how they page (ADR 0006)."""

import re
from base64 import urlsafe_b64decode, urlsafe_b64encode
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Any, Self
from uuid import UUID
from zoneinfo import ZoneInfo, available_timezones

from fastapi.exceptions import RequestValidationError
from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    model_validator,
)

MAX_FUTURE = timedelta(minutes=5)
DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200

RFC_3339 = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})")
TIMEZONES = available_timezones()


def rfc_3339(value: object) -> object:
    # Pydantic alone also takes numbers and numeric strings, as Unix timestamps.
    if not isinstance(value, str) or not RFC_3339.fullmatch(value):
        raise ValueError("Must be RFC 3339 with an offset.")
    return value


def not_in_the_future(value: datetime) -> datetime:
    if value > datetime.now(UTC) + MAX_FUTURE:
        raise ValueError("Must be at most 5 minutes in the future.")
    return value


def known_timezone(value: str) -> str:
    if value not in TIMEZONES:
        raise ValueError("Must be an IANA timezone name.")
    return value


OccurredAt = Annotated[AwareDatetime, BeforeValidator(rfc_3339), AfterValidator(not_in_the_future)]
OccurredTz = Annotated[str, AfterValidator(known_timezone)]


class PutOccurrence(BaseModel):
    """The request fields that say when something happened, and the Day that follows."""

    model_config = ConfigDict(extra="forbid")

    occurred_at: OccurredAt
    occurred_tz: OccurredTz

    @property
    def day(self) -> date:
        return self.occurred_at.astimezone(ZoneInfo(self.occurred_tz)).date()

    @model_validator(mode="after")
    def day_exists(self) -> Self:
        # ADR 0006 sets no past bound, but year 1 at a +14:00 offset has no UTC equivalent.
        try:
            _ = self.day
        except OverflowError:
            raise ValueError("occurred_at is out of range.") from None
        return self


class Occurrence(BaseModel):
    """The response fields every Meal and Exercise Entry has, derived ones included."""

    id: UUID
    occurred_at: datetime
    occurred_tz: str
    day: date
    number: int


def encode_cursor(last: Occurrence) -> str:
    position = f"{last.day}|{last.occurred_at.isoformat()}|{last.id}"
    return urlsafe_b64encode(position.encode()).decode()


def decode_cursor(cursor: str) -> dict[str, Any]:
    try:
        day, occurred_at, row_id = urlsafe_b64decode(cursor).decode().split("|")
        return {
            "cursor_day": date.fromisoformat(day),
            "cursor_at": datetime.fromisoformat(occurred_at),
            "cursor_id": UUID(row_id),
        }
    except ValueError:
        raise invalid_field(("query", "cursor"), "Not a cursor from this API.") from None


def range_filters(
    alias: str, from_day: date | None, to_day: date | None, cursor: str | None
) -> tuple[list[str], dict[str, Any]]:
    """The WHERE terms and parameters both range feeds share. `alias` is the table's."""
    where = ["true"]
    params: dict[str, Any] = {}
    if from_day is not None:
        where.append(f"{alias}.day >= :from_day")
        params["from_day"] = from_day
    if to_day is not None:
        where.append(f"{alias}.day <= :to_day")
        params["to_day"] = to_day
    if cursor is not None:
        # Newest first, so the next page is everything before the last row seen.
        where.append(
            f"({alias}.day, {alias}.occurred_at, {alias}.id)"
            " < (:cursor_day, :cursor_at, :cursor_id)"
        )
        params.update(decode_cursor(cursor))
    return where, params


def invalid_field(location: tuple[str, ...], message: str) -> RequestValidationError:
    """A 422 found after parsing, in the same shape as one found by the request models."""
    return RequestValidationError([{"type": "value_error", "loc": location, "msg": message}])
