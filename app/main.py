from contextlib import asynccontextmanager

from fastapi import FastAPI, Response, status

from .db import pool
from .errors import register_error_handlers
from .routers import exercises, foods, meals, workouts


@asynccontextmanager
async def lifespan(app: FastAPI):
    pool.open()
    yield
    pool.close()


app = FastAPI(title="health-tracker", lifespan=lifespan)
register_error_handlers(app)
app.include_router(foods.router)
app.include_router(meals.router)
app.include_router(workouts.router)
app.include_router(exercises.router)

@app.get("/livez")
def livez():
    """Process is up. Never touches the database."""
    return {"status": "ok"}


@app.get("/readyz")
def readyz(response: Response):
    """Can we reach Postgres? Used for the Kubernetes readiness probe."""
    try:
        with pool.connection(timeout=2) as conn:
            conn.execute("SELECT 1")
    except Exception:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "unavailable"}
    return {"status": "ready"}

def custom_openapi():
    # FastAPI documents a 422 validation response on every route, but this app returns
    # 400 in the contract's error shape (see errors.py), so drop the built-in 422 entries.
    schema = FastAPI.openapi(app)
    for path_item in schema["paths"].values():
        for operation in path_item.values():
            operation["responses"].pop("422", None)
    for name in ("HTTPValidationError", "ValidationError"):
        schema["components"]["schemas"].pop(name, None)
    return schema
app.openapi = custom_openapi
