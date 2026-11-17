"""The smoke script against a stub of the two sidecars, so its own logic is tested without a
cluster. The stub answers as oauth2-proxy does with no session; each flag breaks one rule."""

import threading
from collections.abc import Iterator
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from health_api.smoke import FORGED_IDENTITY, SmokeFailure, run


@dataclass
class Stub:
    url: str = ""
    # Each one is a way the auth boundary could be broken.
    api_open: bool = False
    trusts_forged_headers: bool = False
    api_redirects: bool = False
    web_open: bool = False
    web_readyz_leaks: bool = False


class Handler(BaseHTTPRequestHandler):
    stub: Stub

    def log_message(self, format: str, *args: object) -> None:
        pass

    def answer(self, status: int, body: bytes = b"", location: str | None = None) -> None:
        self.send_response(status)
        if location is not None:
            self.send_header("Location", location)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        # One server stands in for both Services; the path prefix says which.
        service, _, path = self.path.removeprefix("/").partition("/")
        path = "/" + path
        if path in ("/healthz", "/readyz"):
            leak = service == "web" and self.stub.web_readyz_leaks
            self.answer(200, b'{"status":"ok","version":"1.2.3"}' if leak else b"ok\n")
        elif service == "api":
            forged = self.headers.get("X-Auth-Subject") == FORGED_IDENTITY["X-Auth-Subject"]
            if self.stub.api_open or (forged and self.stub.trusts_forged_headers):
                self.answer(200, b'{"items":[]}')
            elif self.stub.api_redirects:
                self.answer(302, location="/oauth2/start")
            else:
                self.answer(401)
        elif self.stub.web_open:
            self.answer(200, b'<div id="root"></div>')
        else:
            self.answer(403, b'<form action="/oauth2/start">')


@pytest.fixture
def stub() -> Iterator[Stub]:
    state = Stub()
    handler = type("BoundHandler", (Handler,), {"stub": state})
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    state.url = f"http://127.0.0.1:{server.server_port}"
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield state
    server.shutdown()
    server.server_close()
    thread.join()


def run_against(stub: Stub) -> None:
    run(f"{stub.url}/api", f"{stub.url}/web")


def test_passes_when_the_boundary_holds(stub: Stub) -> None:
    run_against(stub)


def test_fails_when_api_needs_no_session(stub: Stub) -> None:
    stub.api_open = True
    with pytest.raises(SmokeFailure, match="no session on /api is refused"):
        run_against(stub)


def test_fails_when_forged_headers_are_trusted(stub: Stub) -> None:
    stub.trusts_forged_headers = True
    with pytest.raises(SmokeFailure, match="forged identity headers are refused"):
        run_against(stub)


def test_fails_when_api_redirects_instead_of_401(stub: Stub) -> None:
    stub.api_redirects = True
    with pytest.raises(SmokeFailure, match="expected 401, got 302"):
        run_against(stub)


def test_fails_when_web_needs_no_session(stub: Stub) -> None:
    stub.web_open = True
    with pytest.raises(SmokeFailure, match="Sign-in page"):
        run_against(stub)


def test_fails_when_web_readyz_says_more_than_a_status(stub: Stub) -> None:
    stub.web_readyz_leaks = True
    with pytest.raises(SmokeFailure, match="more than a status"):
        run_against(stub)
