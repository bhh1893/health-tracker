"""Post-deploy smoke test, run in the cluster as a PostSync hook (ADR 0014, ADR 0016).

Checks the auth boundary only, with no credential: the `api` and `web` Services, so the
oauth2-proxy sidecars answer as they do for real traffic. Reads and writes are covered by
the integration tests on real Postgres, not here (ADR 0014, "identity in tests").
Standard library only, because the image has no dev dependencies.
"""

import os
import sys
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener

TIMEOUT_SECONDS = 10

# What a client could send to pose as someone. With no session the sidecar must refuse
# before `api` ever sees them (ADR 0021).
FORGED_IDENTITY = {
    "X-Auth-Issuer": "https://accounts.google.com",
    "X-Auth-Subject": "smoke-forged-subject",
    "X-Auth-Name": "Smoke Forged",
    "X-Auth-Email": "smoke-forged@example.com",
}


class SmokeFailure(Exception):
    """The deployed app answered, but not as it should."""


class _NoRedirects(HTTPRedirectHandler):
    # urllib follows redirects by default, which would hide the one answer that matters
    # most: a 401 on /api/* must not be a redirect to sign-in. Returning None makes
    # urllib raise the 3xx as an HTTPError, which `call` hands back as a status.
    def redirect_request(self, *args: object, **kwargs: object) -> None:
        return None


_opener = build_opener(_NoRedirects)


def call(url: str, headers: dict[str, str] | None = None) -> tuple[int, bytes]:
    request = Request(url, headers=headers or {}, method="GET")
    try:
        with _opener.open(request, timeout=TIMEOUT_SECONDS) as response:
            return response.status, response.read()
    # urllib raises on 3xx (with redirects off), 4xx and 5xx, and here those are
    # answers to check, not errors.
    except HTTPError as error:
        return error.code, error.read()


def expect(step: str, actual: int, expected: int) -> None:
    if actual != expected:
        raise SmokeFailure(f"{step}: expected {expected}, got {actual}")
    print(f"ok: {step} ({actual})", flush=True)


def run(api_url: str, web_url: str) -> None:
    status, _ = call(f"{api_url}/api/v1/meals")
    expect("no session on /api is refused", status, 401)

    status, _ = call(f"{api_url}/api/v1/meals", FORGED_IDENTITY)
    expect("forged identity headers are refused", status, 401)

    status, _ = call(f"{api_url}/readyz")
    expect("api is ready through its sidecar", status, 200)

    # oauth2-proxy serves the Sign-in page itself, with 403, rather than redirecting.
    status, content = call(f"{web_url}/")
    expect("no session on / gets the Sign-in page", status, 403)
    if b"/oauth2/start" not in content:
        raise SmokeFailure(f"no session on / gets the Sign-in page: got {content[:200]!r}")

    # Public through the Gateway (ADR 0025), so nothing but a status.
    status, content = call(f"{web_url}/readyz")
    expect("web is ready through its sidecar", status, 200)
    if content.strip() != b"ok":
        raise SmokeFailure(f"web's /readyz says more than a status: {content[:200]!r}")


def main() -> int:
    try:
        run(os.environ["SMOKE_API_URL"], os.environ["SMOKE_WEB_URL"])
    except SmokeFailure as failure:
        print(f"FAILED: {failure}", file=sys.stderr)
        return 1
    print("smoke test passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
