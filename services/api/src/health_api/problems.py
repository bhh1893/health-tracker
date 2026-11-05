"""RFC 9457 Problem Details: every error leaves the API in this one shape (ADR 0006).

This is the skeleton's stub. Later tickets add typed problems and the 409 extensions.
"""

from collections.abc import Callable
from http import HTTPStatus
from typing import Any, cast

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from starlette.exceptions import HTTPException

PROBLEM_MEDIA_TYPE = "application/problem+json"
NO_BODY_STATUSES = frozenset({204, 304})


class FieldError(BaseModel):
    field: str
    message: str


class Problem(BaseModel):
    type: str = "about:blank"
    title: str
    status: int
    detail: str | None = None
    errors: list[FieldError] | None = None


def problem_response(
    status: int,
    detail: str | None = None,
    errors: list[FieldError] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    problem = Problem(title=HTTPStatus(status).phrase, status=status, detail=detail, errors=errors)
    return JSONResponse(
        problem.model_dump(exclude_none=True),
        status_code=status,
        media_type=PROBLEM_MEDIA_TYPE,
        headers=headers,
    )


def _http_exception(_: Request, exc: Exception) -> Response:
    assert isinstance(exc, HTTPException)
    headers = dict(exc.headers) if exc.headers else None
    if exc.status_code in NO_BODY_STATUSES:
        return Response(status_code=exc.status_code, headers=headers)
    # FastAPI allows any detail, but Problem.detail is text. A handler that raises turns the
    # intended status into a 500, so keep the status and drop a detail that does not fit.
    detail = cast("object", exc.detail)
    return problem_response(
        exc.status_code, detail=detail if isinstance(detail, str) else None, headers=headers
    )


def _validation_error(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)
    errors = [
        FieldError(field=".".join(str(part) for part in error["loc"]), message=error["msg"])
        for error in exc.errors()
    ]
    return problem_response(422, errors=errors)


def _unhandled_exception(_: Request, __: Exception) -> JSONResponse:
    # No exception text in the body: it can hold SQL or values. The server still re-raises
    # after this response, so uvicorn logs the traceback.
    return problem_response(500)


def register_problem_handlers(app: FastAPI) -> None:
    app.add_exception_handler(HTTPException, _http_exception)
    app.add_exception_handler(RequestValidationError, _validation_error)
    app.add_exception_handler(Exception, _unhandled_exception)


def document_problem_media_type(app: FastAPI) -> None:
    """Make the schema tell the truth about errors, which are all Problems here.

    FastAPI labels every declared body application/json, and adds its own 422 shape to any
    route with inputs. Both the media type and the 422 schema have to be replaced.
    """
    generate: Callable[[], dict[str, Any]] = app.openapi

    def openapi() -> dict[str, Any]:
        schema = generate()
        for path in schema["paths"].values():
            for operation in path.values():
                for status, response in operation["responses"].items():
                    content = response.get("content", {})
                    if not status.startswith("2") and "application/json" in content:
                        del content["application/json"]
                        content[PROBLEM_MEDIA_TYPE] = {
                            "schema": {"$ref": "#/components/schemas/Problem"}
                        }
        for unused in ("HTTPValidationError", "ValidationError"):
            schema["components"]["schemas"].pop(unused, None)
        return schema

    app.openapi = openapi
