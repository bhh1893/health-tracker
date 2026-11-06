"""Post-deploy smoke test, run in the cluster as a PostSync hook (ADR 0014, ADR 0016).

Goes through the Service, so one run covers the sidecar's token check, `api` and Postgres.
/healthz is not checked: the Service does not route to it. The Meals ticket swaps the Food
round trip for a Meal. Standard library only, because the image has no dev dependencies.
"""

import json
import os
import sys
from pathlib import Path
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
    body: dict[str, str] | None = None,
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
    status, _ = call(base_url, "GET", "/api/v1/foods")
    expect("no token is refused", status, 401)

    status, _ = call(base_url, "GET", "/api/v1/foods", token)
    expect("token is accepted", status, 200)

    item_id = uuid7()
    path = f"/api/v1/foods/{item_id}"
    name = f"smoke-{item_id}"
    try:
        status, _ = call(base_url, "PUT", path, token, {"name": name})
        expect("create a Food", status, 201)

        status, content = call(base_url, "GET", path, token)
        expect("read it back", status, 200)
        if json.loads(content)["name"] != name:
            raise SmokeFailure(f"read it back: wrong name in {content!r}")
    finally:
        # Also on failure: a broken deploy should not leave test rows in the real data.
        status, _ = call(base_url, "DELETE", path, token)
    expect("delete it", status, 204)

    status, _ = call(base_url, "GET", path, token)
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
