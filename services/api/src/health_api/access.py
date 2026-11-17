"""One access line per request: who, which route, what result, from where (ADR 0030).

Replaces uvicorn's access line, which runs outside the app: it sees the sidecar (127.0.0.1)
as the client, knows no User, and logs the filled-in path.
"""

import logging
from typing import Any
from uuid import UUID

from fastapi import Request
from starlette.datastructures import Headers
from starlette.routing import Route
from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger(__name__)

PROBE_PATHS = frozenset({"/healthz", "/readyz"})

# Cloudflare sets this on every request and refuses one that already carries it (ADR 0025).
# X-Forwarded-For is never read: its left entries are whatever the client sent.
CLIENT_IP_HEADER = "cf-connecting-ip"

_USER_ID = "user_id"


def record_user(request: Request, user_id: UUID) -> None:
    """Name the User on this request's access line. Called once identity is known."""
    setattr(request.state, _USER_ID, user_id)


def is_passing_probe(path: str | None, status: int) -> bool:
    """Passing probes would bury real traffic. A failing probe stays visible."""
    return path in PROBE_PATHS and status < 400


class AccessLogMiddleware:
    """Pure ASGI, not BaseHTTPMiddleware, so streaming and background tasks are untouched."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # The same dict `request.state` wraps further in, so record_user's write lands here.
        state: dict[str, Any] = scope.setdefault("state", {})
        # Unchanged only if the app raised before responding. ServerErrorMiddleware, outside
        # this one, then sends a 500.
        status = 500

        async def send_and_note_status(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, send_and_note_status)
        finally:
            _log(scope, state, status)


def _log(scope: Scope, state: dict[str, Any], status: int) -> None:
    # The router stores the matched route in the scope. Its path is the template
    # (/api/v1/meals/{meal_id}), so no id or other value reaches the logs. A path that
    # matched no route has no template and is logged as null for the same reason.
    route = scope.get("route")
    path = route.path if isinstance(route, Route) else None
    if is_passing_probe(path, status):
        return
    user_id: UUID | None = state.get(_USER_ID)
    method: str = scope["method"]
    logger.info(
        "%s %s %s",
        method,
        path,
        status,
        extra={
            "fields": {
                "user_id": str(user_id) if user_id else None,
                "method": method,
                "path": path,
                "status": status,
                "client_ip": Headers(scope=scope).get(CLIENT_IP_HEADER),
            }
        },
    )
