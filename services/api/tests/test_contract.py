"""Lints openapi.json, the file clients and the future MCP wrapper read (ADR 0006)."""

import json
import re
from typing import Any

import pytest

from health_api.export_openapi import OPENAPI_PATH

HTTP_METHODS = {"get", "put", "post", "patch", "delete"}
# FastAPI's default looks like suggest_api_v1_foods_get: stable only until a path changes.
HAND_SET_ID = re.compile(r"^(?!.*_api_v\d)[a-z]+(_[a-z]+)*$")


def operations() -> list[tuple[str, dict[str, Any]]]:
    schema = json.loads(OPENAPI_PATH.read_text())
    return [
        (f"{method.upper()} {path}", operation)
        for path, item in schema["paths"].items()
        for method, operation in item.items()
        if method in HTTP_METHODS
    ]


@pytest.mark.parametrize(("name", "operation"), operations(), ids=lambda value: str(value)[:40])
def test_operation_is_ready_to_become_an_mcp_tool(name: str, operation: dict[str, Any]) -> None:
    assert HAND_SET_ID.match(operation["operationId"]), name
    description = operation.get("description", "")
    assert description.strip(), f"{name} has no description"
    assert "\n" not in description, f"{name} needs a one-line description"


def test_operation_ids_are_unique() -> None:
    ids = [operation["operationId"] for _, operation in operations()]

    assert len(ids) == len(set(ids))


def test_conflicts_document_the_problem_extensions() -> None:
    schema = json.loads(OPENAPI_PATH.read_text())

    problem = schema["components"]["schemas"]["Problem"]["properties"]

    assert {"existing", "similar", "errors"} <= set(problem)
