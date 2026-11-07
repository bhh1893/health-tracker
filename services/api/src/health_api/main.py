from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from health_api import health
from health_api.catalogs import CATALOGS, catalog_router
from health_api.db import create_db_engine
from health_api.logs import configure_logging
from health_api.meals import meals_router
from health_api.migrations import image_revisions
from health_api.problems import (
    DATABASE_UNAVAILABLE,
    document_problem_media_type,
    register_problem_handlers,
)


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
    app = FastAPI(title="Health Tracker API", version="1", lifespan=lifespan)
    register_problem_handlers(app)
    app.include_router(health.router)
    for catalog in CATALOGS:
        app.include_router(catalog_router(catalog), responses=DATABASE_UNAVAILABLE)
    app.include_router(meals_router(), responses=DATABASE_UNAVAILABLE)
    document_problem_media_type(app)
    return app
