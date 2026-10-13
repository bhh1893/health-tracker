# health-tracker

Small API to log workouts (session + appended sets) and meals (per day), backed by Postgres.

## One-time setup in the dev VM

    sudo apt-get install -y python3-venv python3-pip
    python3 -m venv .venv && source .venv/bin/activate
    pip install -r requirements-dev.txt

## Run

    docker compose up -d db migrate      # Postgres + schema
    docker compose logs migrate          # expect "Applying: 20261012000001_initial_schema.sql"
    uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

From Windows: http://192.168.56.20:8000/livez and /readyz (and /docs for the interactive page).

## Test

    pytest -q

## Everything in containers

    docker compose up -d --build

## Reset the database

    docker compose down -v
