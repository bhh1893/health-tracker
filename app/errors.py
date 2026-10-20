import psycopg
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class ApiError(Exception):
    """Raise this from a route to return the contract's error shape."""

    def __init__(self, status_code: int, code: str, message: str):
        self.status_code = status_code
        self.code = code
        self.message = message


def _error(status_code: int, code: str, message: str, details=None) -> JSONResponse:
    body = {"code": code, "message": message}
    if details is not None:
        body["details"] = details
    return JSONResponse(status_code=status_code, content={"error": body})


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def api_error(request: Request, exc: ApiError):
        return _error(exc.status_code, exc.code, exc.message)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        details = [
            {"field": ".".join(str(part) for part in e["loc"]), "message": e["msg"]}
            for e in exc.errors()
        ]
        return _error(400, "validation_failed", "Request validation failed", details)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException):
        # Unknown route (404), wrong method (405), etc.
        return _error(exc.status_code, f"http_{exc.status_code}", str(exc.detail))

    @app.exception_handler(psycopg.OperationalError)
    async def db_unavailable(request: Request, exc: psycopg.OperationalError):
        # Includes psycopg_pool.PoolTimeout: Postgres unreachable.
        return _error(503, "db_unavailable", "Database is unavailable")
