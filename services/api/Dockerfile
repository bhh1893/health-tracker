# Build stage: has uv and the dependency cache. None of it reaches the final image.
FROM ghcr.io/astral-sh/uv:0.13.7 AS uv

# Both python tags must match .python-version; CI fails if they do not.
FROM python:3.14.10-slim-trixie AS build
COPY --from=uv /uv /usr/local/bin/uv
# Use the image's Python, never a downloaded one, so the venv works in the final stage.
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app

# Dependencies first: this layer is reused until uv.lock changes, not on every code edit.
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

COPY src ./src
RUN uv sync --locked --no-dev

# Final stage: Python, the venv, the code and the migrations, and no build tools.
FROM python:3.14.10-slim-trixie
WORKDIR /app
# Same /app path as the build stage: the venv's editable install points at /app/src,
# which is also how the code finds /app/migrations.
COPY --from=build /app/.venv ./.venv
COPY pyproject.toml ./
COPY src ./src
COPY migrations ./migrations
ENV PATH="/app/.venv/bin:$PATH"

# Numeric so Kubernetes runAsNonRoot can verify it without reading /etc/passwd.
USER 10001
EXPOSE 8000
# The migration Job reuses this image with the command `alembic upgrade head` (ADR 0016).
# 127.0.0.1: only the auth sidecar in the same pod can reach this port (ADR 0010).
CMD ["uvicorn", "--factory", "health_api.main:create_app", "--host", "127.0.0.1", "--port", "8000"]
