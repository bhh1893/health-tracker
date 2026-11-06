import json
import logging
import sys

import pytest

from health_api.logs import JsonFormatter, keep_access_record


def test_log_line_is_one_json_object() -> None:
    record = logging.LogRecord("api", logging.INFO, __file__, 1, "saved %s", ("meal",), None)

    entry = json.loads(JsonFormatter().format(record))

    assert entry["level"] == "INFO"
    assert entry["logger"] == "api"
    assert entry["message"] == "saved meal"
    assert entry["timestamp"].endswith("+00:00")


def test_exception_stays_on_one_line() -> None:
    try:
        raise ValueError("bad")
    except ValueError:
        exc_info = sys.exc_info()
    record = logging.LogRecord("api", logging.ERROR, __file__, 1, "failed", (), exc_info)

    line = JsonFormatter().format(record)

    assert "\n" not in line
    assert "ValueError: bad" in json.loads(line)["exception"]


@pytest.mark.parametrize(
    ("path", "status", "kept"),
    [
        ("/healthz", 200, False),
        ("/readyz", 200, False),
        ("/readyz", 503, True),
        ("/api/v1/meals", 200, True),
    ],
)
def test_only_passing_probes_are_dropped(path: str, status: int, kept: bool) -> None:
    args = ("127.0.0.1:1234", "GET", path, "1.1", status)
    record = logging.LogRecord("uvicorn.access", logging.INFO, __file__, 1, "%s", args, None)

    assert keep_access_record(record) is kept
