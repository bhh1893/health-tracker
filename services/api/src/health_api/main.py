from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI

from health_api import health
from health_api.access import AccessLogMiddleware
from health_api.catalogs import CATALOGS, catalog_router
from health_api.days import days_router
from health_api.db import create_db_engine
from health_api.exercise_entries import exercise_entries_router
from health_api.identity import NOT_APPROVED, UNAUTHENTICATED, current_user
from health_api.logs import configure_logging
from health_api.me import me_router
from health_api.meal_days import meal_days_router
from health_api.meals import meals_router
from health_api.migrations import image_revisions
from health_api.problems import (
    DATABASE_UNAVAILABLE,
    document_problem_media_type,
    register_problem_handlers,
)
from health_api.rate_limits import TOO_MANY_REQUESTS, add_rate_limits
from health_api.reference_foods import reference_foods_router


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
    # An image with broken migrations should crash at boot, not fail every probe later.
    image_revisions()
    # Here, not at import, so generating openapi.json needs no DATABASE_URL.
    engine = create_db_engine()
    app.state.engine = engine
    yield
    engine.dispose()


def create_app() -> FastAPI:
    configure_logging()
    app = FastAPI(
        title="Health Tracker API",
        version="1",
        lifespan=lifespan,
        # No /docs, /redoc or /openapi.json: every route is one the contract lists, and the
        # contract is the committed openapi.json (ADR 0014).
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    register_problem_handlers(app)
    # Added first so it sits inside the access log: add_middleware wraps the app in the
    # newest middleware, so a refused request still gets its access line.
    add_rate_limits(app)
    # Inside ServerErrorMiddleware, which add_middleware always keeps outermost: an
    # unhandled exception passes through here first, so its line says 500.
    app.add_middleware(AccessLogMiddleware)
    app.include_router(health.router)
    # Every data route needs an approved User (ADR 0021). Declared once here, per router, so
    # no endpoint can forget it; test_authorization.py proves it held (ADR 0014). FastAPI
    # caches a dependency per request, so an endpoint that also takes CurrentUser for the id
    # costs no second lookup. /api/me declares its own: GET is open to Pending. Every /api
    # route can be rate limited; the probes never are.
    data_routers = (
        *(catalog_router(catalog) for catalog in CATALOGS),
        meals_router(),
        meal_days_router(),
        exercise_entries_router(),
        days_router(),
        reference_foods_router(),
    )
    api = {**DATABASE_UNAVAILABLE, **TOO_MANY_REQUESTS}
    data = {**api, **UNAUTHENTICATED, **NOT_APPROVED}
    for router in data_routers:
        app.include_router(router, dependencies=[Depends(current_user)], responses=data)
    app.include_router(me_router(), responses=api)
    document_problem_media_type(app)
    return app
