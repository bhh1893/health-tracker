"""Probes for Kubernetes, outside /api/v1 and not routed by the edge (ADR 0006)."""

import logging
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy.exc import OperationalError, SQLAlchemyError

from health_api.db import DbSession
from health_api.migrations import schema_is_ready
from health_api.problems import Problem

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])


class HealthStatus(BaseModel):
    status: Literal["ok"] = "ok"


# async so it runs on the event loop: liveness must not wait behind a full thread pool,
# and it deliberately touches no database, or a Postgres outage would restart every pod.
@router.get("/healthz", operation_id="get_healthz", description="Liveness: the process is up.")
async def healthz() -> HealthStatus:
    return HealthStatus()


@router.get(
    "/readyz",
    operation_id="get_readyz",
    description="Readiness: the database is reachable and migrated.",
    responses={503: {"model": Problem, "description": "Not ready to serve traffic."}},
)
def readyz(session: DbSession) -> HealthStatus:
    try:
        ready = schema_is_ready(session.connection())
    except OperationalError:
        logger.warning("readiness check could not connect", exc_info=True)
        raise HTTPException(503, "Could not connect to the database.") from None
    except SQLAlchemyError:
        logger.warning("readiness check query failed", exc_info=True)
        raise HTTPException(503, "Connected, but the readiness query failed.") from None
    if not ready:
        raise HTTPException(503, "Database migrations have not been applied.")
    return HealthStatus()
