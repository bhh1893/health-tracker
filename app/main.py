from contextlib import asynccontextmanager

from fastapi import FastAPI, Response, status

from .db import pool


@asynccontextmanager
async def lifespan(app: FastAPI):
    pool.open()
    yield
    pool.close()


app = FastAPI(title="health-tracker", lifespan=lifespan)


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
