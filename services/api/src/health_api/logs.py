"""Structured logging: one JSON object per line on stdout, for the cluster to collect."""

import json
import logging
import sys
from datetime import UTC, datetime
from typing import override

PROBE_PATHS = frozenset({"/healthz", "/readyz"})


class JsonFormatter(logging.Formatter):
    @override
    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "timestamp": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(entry)


def keep_access_record(record: logging.LogRecord) -> bool:
    """Drop passing probes, which would bury real traffic. A failing probe stays visible."""
    # uvicorn.access logs with args (client, method, path, http_version, status).
    match record.args:
        case (_, _, str(path), _, int(status)):
            return not (path in PROBE_PATHS and status < 400)
        case _:
            return True


def configure_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    logging.basicConfig(level=logging.INFO, handlers=[handler], force=True)
    # uvicorn installs its own plain-text handlers; send its records through ours instead.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        logger.handlers.clear()
        logger.propagate = True
    logging.getLogger("uvicorn.access").addFilter(keep_access_record)
