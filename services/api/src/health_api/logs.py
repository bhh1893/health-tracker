"""Structured logging: one JSON object per line on stdout, for the cluster to collect."""

import json
import logging
import sys
from datetime import UTC, datetime
from typing import override


class JsonFormatter(logging.Formatter):
    @override
    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, object] = {
            "timestamp": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        # Structured fields a caller passed as extra={"fields": {...}}, top level so
        # `jq 'select(.user_id == "...")'` works on `kubectl logs`.
        fields: dict[str, object] = getattr(record, "fields", {})
        entry.update(fields)
        if record.exc_info:
            entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(entry)


def configure_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    logging.basicConfig(level=logging.INFO, handlers=[handler], force=True)
    # uvicorn installs its own plain-text handlers; send its records through ours instead.
    # Its access line is off (--no-access-log in the Dockerfile): access.py writes a better one.
    for name in ("uvicorn", "uvicorn.error"):
        logger = logging.getLogger(name)
        logger.handlers.clear()
        logger.propagate = True
