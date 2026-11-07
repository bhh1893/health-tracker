"""Post-deploy smoke test, run in the cluster as a PostSync hook (ADR 0014, ADR 0016).

Goes through the Service, so one run covers the sidecar's token check, `api` and Postgres.
/healthz is not checked: the Service does not route to it. Standard library only, because
the image has no dev dependencies.
"""

import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid7

TIMEOUT_SECONDS = 10


class SmokeFailure(Exception):
    """The deployed app answered, but not as it should."""


def call(
    base_url: str,
    method: str,
    path: str,
    token: str | None = None,
    body: dict[str, Any] | None = None,
) -> tuple[int, bytes]:
    headers = {"Content-Type": "application/json"}
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    data = None if body is None else json.dumps(body).encode()
    request = Request(base_url + path, data=data, headers=headers, method=method)
    try:
        with urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            return response.status, response.read()
    # urllib raises on 4xx and 5xx, and here those are answers to check, not errors.
    except HTTPError as error:
        return error.code, error.read()


def expect(step: str, actual: int, expected: int) -> None:
    if actual != expected:
        raise SmokeFailure(f"{step}: expected {expected}, got {actual}")
    print(f"ok: {step} ({actual})", flush=True)


def run(base_url: str, token: str) -> None:
    # Before anything is written: a broken token check must not get a write through.
    status, _ = call(base_url, "GET", "/api/v1/meals")
    expect("no token is refused", status, 401)

    status, _ = call(base_url, "GET", "/api/v1/meals", "not-the-token")
    expect("wrong token is refused", status, 401)

    status, _ = call(base_url, "GET", "/api/v1/meals", token)
    expect("token is accepted", status, 200)

    food_id, meal_id = uuid7(), uuid7()
    food_path = f"/api/v1/foods/{food_id}"
    meal_path = f"/api/v1/meals/{meal_id}"
    name = f"smoke-{food_id}"
    meal = {
        "kind": "foods",
        "occurred_at": datetime.now(UTC).isoformat(),
        "occurred_tz": "UTC",
        "food_entries": [{"food_id": str(food_id), "quantity": 1, "unit": "count"}],
    }
    try:
        # allow_similar: a run killed before its cleanup must not fail every later run.
        status, _ = call(base_url, "PUT", food_path, token, {"name": name, "allow_similar": True})
        expect("create a Food", status, 201)

        status, _ = call(base_url, "PUT", meal_path, token, meal)
        expect("create a Meal", status, 201)

        status, content = call(base_url, "GET", meal_path, token)
        expect("read it back", status, 200)
        if json.loads(content)["food_entries"][0]["food"]["name"] != name:
            raise SmokeFailure(f"read it back: wrong Food in {content!r}")

        status, _ = call(base_url, "GET", meal_path)
        expect("reading it with no token is refused", status, 401)
    finally:
        # Also on failure: a broken deploy should not leave test rows in the real data.
        # The Meal first: a Food in use cannot be deleted.
        meal_status, _ = call(base_url, "DELETE", meal_path, token)
        food_status, _ = call(base_url, "DELETE", food_path, token)
    expect("delete the Meal", meal_status, 204)
    expect("delete the Food", food_status, 204)

    status, _ = call(base_url, "GET", meal_path, token)
    expect("it is gone", status, 404)


def main() -> int:
    token = Path(os.environ["SMOKE_TOKEN_FILE"]).read_text().strip()
    try:
        run(os.environ["SMOKE_BASE_URL"], token)
    except SmokeFailure as failure:
        print(f"FAILED: {failure}", file=sys.stderr)
        return 1
    print("smoke test passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
