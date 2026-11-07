"""The smoke script against a stub of the API, so its own logic is tested without a cluster."""

import json
import threading
import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import pytest
import uvicorn
from fastapi import Request, Response
from starlette.middleware.base import RequestResponseEndpoint

from health_api.main import create_app
from health_api.smoke import SmokeFailure, run

TOKEN = "test-token"


@dataclass
class Stub:
    url: str = ""
    foods: dict[str, str] = field(default_factory=dict[str, str])
    meals: dict[str, dict[str, Any]] = field(default_factory=dict[str, dict[str, Any]])
    deletes: int = 0
    enforce_token: bool = True
    accept_any_token: bool = False
    corrupt_reads: bool = False


class Handler(BaseHTTPRequestHandler):
    stub: Stub

    def log_message(self, format: str, *args: object) -> None:
        pass

    def answer(self, status: int, body: object = None) -> None:
        content = b"" if body is None else json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def authorized(self) -> bool:
        if not self.stub.enforce_token:
            return True
        authorization = self.headers.get("Authorization")
        if authorization == f"Bearer {TOKEN}":
            return True
        if self.stub.accept_any_token and authorization is not None:
            return True
        self.answer(401)
        return False

    def do_GET(self) -> None:
        if not self.authorized():
            return
        if self.path == "/api/v1/meals":
            self.answer(200, {"items": [], "next_cursor": None})
        elif self.path in self.stub.meals:
            food_id = self.stub.meals[self.path]["food_entries"][0]["food_id"]
            name = self.stub.foods[f"/api/v1/foods/{food_id}"]
            name = "wrong" if self.stub.corrupt_reads else name
            self.answer(200, {"food_entries": [{"food": {"name": name}}]})
        else:
            self.answer(404)

    def do_PUT(self) -> None:
        if not self.authorized():
            return
        length = int(self.headers["Content-Length"])
        body = json.loads(self.rfile.read(length))
        if self.path.startswith("/api/v1/foods/"):
            self.stub.foods[self.path] = body["name"]
        else:
            self.stub.meals[self.path] = body
        self.answer(201, {})

    def do_DELETE(self) -> None:
        if not self.authorized():
            return
        self.stub.deletes += 1
        # As the foreign key does: a Food in use cannot be deleted.
        if self.path.startswith("/api/v1/foods/") and self.stub.meals:
            self.answer(409)
            return
        self.stub.foods.pop(self.path, None)
        self.stub.meals.pop(self.path, None)
        self.answer(204)


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


@pytest.fixture
def real_api(database_url: str) -> Iterator[str]:
    """The real app on real Postgres, behind a stand-in for the sidecar's token check."""

    async def check_token(request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.headers.get("Authorization") != f"Bearer {TOKEN}":
            return Response(status_code=401)
        return await call_next(request)

    app = create_app()
    app.middleware("http")(check_token)
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=0, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    while not server.started:
        time.sleep(0.01)
    port = server.servers[0].sockets[0].getsockname()[1]
    yield f"http://127.0.0.1:{port}"
    server.should_exit = True
    thread.join()


def test_passes_against_the_real_api(real_api: str) -> None:
    """The stub accepts any body. Only this proves the real API takes what the script sends."""
    run(real_api, TOKEN)


def test_passes_and_leaves_no_rows_behind(stub: Stub) -> None:
    run(stub.url, TOKEN)
    assert stub.foods == {}
    assert stub.meals == {}


def test_never_prints_the_token(stub: Stub, capsys: pytest.CaptureFixture[str]) -> None:
    run(stub.url, TOKEN)
    assert TOKEN not in capsys.readouterr().out


def test_fails_when_the_token_check_is_off(stub: Stub) -> None:
    stub.enforce_token = False
    with pytest.raises(SmokeFailure, match="no token is refused"):
        run(stub.url, TOKEN)


def test_fails_when_any_token_is_accepted(stub: Stub) -> None:
    stub.accept_any_token = True
    with pytest.raises(SmokeFailure, match="wrong token is refused"):
        run(stub.url, TOKEN)


def test_fails_on_a_bad_token(stub: Stub) -> None:
    with pytest.raises(SmokeFailure, match="token is accepted"):
        run(stub.url, "not-the-token")


def test_cleans_up_when_the_read_back_is_wrong(stub: Stub) -> None:
    stub.corrupt_reads = True
    with pytest.raises(SmokeFailure, match="wrong Food"):
        run(stub.url, TOKEN)
    assert stub.deletes == 2
    assert stub.foods == {}
    assert stub.meals == {}
