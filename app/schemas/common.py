import re
from datetime import date
from typing import Annotated, Any

from pydantic import BeforeValidator

_ISO_DATE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")


def _require_iso(value: Any) -> Any:
    # Without this, Pydantic also accepts things like "86400" (a Unix timestamp)
    # or "2026-10-12T00:00:00". Only YYYY-MM-DD is allowed.
    if isinstance(value, str) and not _ISO_DATE.fullmatch(value):
        raise ValueError("date must be formatted YYYY-MM-DD")
    return value


IsoDate = Annotated[date, BeforeValidator(_require_iso)]
