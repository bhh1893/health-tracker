"""RFC 9457 Problem Details: every error leaves the API in this one shape (ADR 0006)."""

import logging
from collections.abc import Callable
from http import HTTPStatus
from typing import Any, cast
from uuid import UUID

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from sqlalchemy.exc import OperationalError
from sqlalchemy.exc import TimeoutError as PoolTimeoutError
from starlette.exceptions import HTTPException

logger = logging.getLogger(__name__)

PROBLEM_MEDIA_TYPE = "application/problem+json"
NO_BODY_STATUSES = frozenset({204, 304})

# `type` is how a client tells one 409 from another without parsing `detail`. These are names,
# not links: RFC 9457 allows a URI nobody can fetch, and a URN cannot look like a broken URL.
EXACT_DUPLICATE = "urn:health-tracker:problem:exact-duplicate"
NEAR_DUPLICATE = "urn:health-tracker:problem:near-duplicate"
ITEM_IN_USE = "urn:health-tracker:problem:item-in-use"
LAST_FOOD_ENTRY = "urn:health-tracker:problem:last-food-entry"
KIND_IMMUTABLE = "urn:health-tracker:problem:kind-immutable"


class FieldError(BaseModel):
    field: str
    message: str


class CatalogRef(BaseModel):
    """How any response points at a Catalog item (ADR 0006)."""

    id: UUID
    name: str
    archived: bool


class Problem(BaseModel):
    type: str = "about:blank"
    title: str
    status: int
    detail: str | None = None
    errors: list[FieldError] | None = None
    existing: CatalogRef | None = None
    similar: list[CatalogRef] | None = None


# Every route that touches the database can answer this, so it is declared once, in main.py.
DATABASE_UNAVAILABLE: dict[int | str, dict[str, Any]] = {
    503: {"model": Problem, "description": "The database is unavailable. Safe to retry."}
}


class ProblemError(Exception):
    """Raise for an error that carries more than text, which HTTPException cannot deliver."""

    def __init__(
        self,
        status: int,
        *,
        type: str,
        detail: str,
        existing: CatalogRef | None = None,
        similar: list[CatalogRef] | None = None,
    ) -> None:
        super().__init__(detail)
        self.status = status
        self.type = type
        self.detail = detail
        self.existing = existing
        self.similar = similar


def problem_response(
    status: int,
    detail: str | None = None,
    errors: list[FieldError] | None = None,
    headers: dict[str, str] | None = None,
    type: str = "about:blank",
    existing: CatalogRef | None = None,
    similar: list[CatalogRef] | None = None,
) -> JSONResponse:
    problem = Problem(
        type=type,
        title=HTTPStatus(status).phrase,
        status=status,
        detail=detail,
        errors=errors,
        existing=existing,
        similar=similar,
    )
    return JSONResponse(
        # mode="json" turns UUIDs into text. Without it JSONResponse raises, and the 409 is a 500.
        problem.model_dump(mode="json", exclude_none=True),
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


def _problem_error(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, ProblemError)
    return problem_response(
        exc.status, detail=exc.detail, type=exc.type, existing=exc.existing, similar=exc.similar
    )


def _validation_error(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)
    errors = [
        FieldError(field=".".join(str(part) for part in error["loc"]), message=error["msg"])
        for error in exc.errors()
    ]
    return problem_response(422, errors=errors)


def _database_unavailable(_: Request, exc: Exception) -> JSONResponse:
    # Unlike a 500, nothing re-raises this one, so the cause is logged here or not at all.
    logger.warning("database unavailable", exc_info=exc)
    return problem_response(503, detail="The database is unavailable. Try again shortly.")


def _unhandled_exception(_: Request, __: Exception) -> JSONResponse:
    # No exception text in the body: it can hold SQL or values. The server still re-raises
    # after this response, so uvicorn logs the traceback.
    return problem_response(500)


def register_problem_handlers(app: FastAPI) -> None:
    app.add_exception_handler(HTTPException, _http_exception)
    app.add_exception_handler(ProblemError, _problem_error)
    app.add_exception_handler(RequestValidationError, _validation_error)
    # OperationalError: connecting failed, or the connection died mid-request. PoolTimeoutError:
    # every pooled connection stayed busy, which is what hung connections look like from here.
    app.add_exception_handler(OperationalError, _database_unavailable)
    app.add_exception_handler(PoolTimeoutError, _database_unavailable)
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
