import json
import logging
import sys

from health_api.logs import JsonFormatter


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
