"""Per-User rate and write limits, checked before any database work (ADR 0027, ADR 0030).

Counters live in this process's memory, so each pod counts on its own: with 2 replicas a User
can make up to twice the configured rate. The limits stop runaway clients and slow a stolen
session or a Member filling the database; they are not exact quotas.
"""

import json
import logging
import math
import os
import time
from typing import Any

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from limits import RateLimitItem, parse
from limits.storage import MemoryStorage
from limits.strategies import MovingWindowRateLimiter
from starlette.datastructures import Headers
from starlette.types import ASGIApp, Receive, Scope, Send

from health_api.access import CLIENT_IP_HEADER, PROBE_PATHS
from health_api.identity import ISSUER_HEADER, SUBJECT_HEADER
from health_api.problems import RATE_LIMITED, Problem, problem_response

logger = logging.getLogger(__name__)

# Defaults match ADR 0027 so tests and the OpenAPI export need no setup. The manifest sets
# both anyway, so the values in force are visible where they are changed.
RATE_LIMIT_ENV = "RATE_LIMIT"
WRITE_RATE_LIMIT_ENV = "WRITE_RATE_LIMIT"
DEFAULT_RATE_LIMIT = "300/minute"
DEFAULT_WRITE_RATE_LIMIT = "60/minute"

WRITE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})

TOO_MANY_REQUESTS: dict[int | str, dict[str, Any]] = {
    429: {
        "model": Problem,
        "description": "The User passed a rate limit. Wait Retry-After seconds.",
        "headers": {
            "Retry-After": {
                "description": "Seconds until the next request can succeed.",
                "schema": {"type": "integer"},
            }
        },
    }
}


class RateLimits:
    """ASGI middleware: it runs before routing, so before any dependency opens a session.

    A plain ASGI class rather than Starlette's BaseHTTPMiddleware, which wraps every response
    in a stream and is the documented source of several Starlette bugs.
    """

    def __init__(self, app: ASGIApp, *, rate: RateLimitItem, write_rate: RateLimitItem) -> None:
        self.app = app
        # (name, limit, applies to writes only). The name keeps the two counters apart even
        # when both are configured to the same value.
        self.limits = [("all", rate, False), ("writes", write_rate, True)]
        # Moving window: counts the last minute at every request, so unlike a fixed window
        # that resets on the minute, no burst across the boundary gets twice the limit in.
        self.limiter = MovingWindowRateLimiter(MemoryStorage())

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["path"] in PROBE_PATHS:
            # Probes carry no identity (ADR 0010); a shared anonymous counter could run out
            # and get a healthy pod restarted.
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        issuer = headers.get(ISSUER_HEADER)
        subject = headers.get(SUBJECT_HEADER)
        if not issuer or not subject:
            # Nobody to count. identity.py answers 401 before any query.
            await self.app(scope, receive, send)
            return

        # JSON, not "issuer/subject": an issuer is a URL full of slashes, so joining by hand
        # could make two different Users one key.
        user = json.dumps([issuer, subject])
        is_write = scope["method"] in WRITE_METHODS
        applicable = [
            (name, limit) for name, limit, writes in self.limits if is_write or not writes
        ]
        # Test all first, then hit all, so a refused request uses up nothing. Nothing awaits
        # in between, so no other request on this event loop can slip in.
        for name, limit in applicable:
            if not self.limiter.test(limit, name, user):
                response = self._refuse(name, limit, user, issuer, subject, headers)
                await response(scope, receive, send)
                return
        for name, limit in applicable:
            self.limiter.hit(limit, name, user)
        await self.app(scope, receive, send)

    def _refuse(
        self,
        name: str,
        limit: RateLimitItem,
        user: str,
        issuer: str,
        subject: str,
        headers: Headers,
    ) -> JSONResponse:
        # The oldest counted request leaves the window at reset_time, freeing one slot.
        reset_time = self.limiter.get_window_stats(limit, name, user).reset_time
        retry_after = max(1, math.ceil(reset_time - time.time()))
        # The User's id would need the database lookup this check exists to avoid, and
        # (issuer, subject) names exactly one users row: `iac/scripts/users list` maps it.
        logger.warning(
            "rate limit %s (%s) passed by issuer=%s subject=%s from %s",
            name,
            limit,
            issuer,
            subject,
            # For the log only: every request here has an identity, so none is limited per IP.
            headers.get(CLIENT_IP_HEADER, "unknown"),
        )
        return problem_response(
            429,
            type=RATE_LIMITED,
            detail="Too many requests. Wait a moment and try again.",
            headers={"Retry-After": str(retry_after)},
        )


def _limit_from_env(name: str, default: str) -> RateLimitItem:
    value = os.environ.get(name, default)
    try:
        return parse(value)
    except ValueError as error:
        # At boot, so a typo in the manifest crash-loops the new pods and the rollout stops,
        # instead of serving with no limit.
        raise ValueError(f"{name}={value!r} is not a rate like 300/minute") from error


def add_rate_limits(app: FastAPI) -> None:
    app.add_middleware(
        RateLimits,
        rate=_limit_from_env(RATE_LIMIT_ENV, DEFAULT_RATE_LIMIT),
        write_rate=_limit_from_env(WRITE_RATE_LIMIT_ENV, DEFAULT_WRITE_RATE_LIMIT),
    )
