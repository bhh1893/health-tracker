"""The smoke script against a stub of the API, so its own logic is tested without a cluster."""

import json
import threading
from collections.abc import Iterator
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from health_api.smoke import SmokeFailure, run

TOKEN = "test-token"


@dataclass
class Stub:
    url: str = ""
    items: dict[str, str] = field(default_factory=dict[str, str])
    deletes: int = 0
    enforce_token: bool = True
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
        if self.headers.get("Authorization") == f"Bearer {TOKEN}":
            return True
        self.answer(401)
        return False

    def do_GET(self) -> None:
        if not self.authorized():
            return
        if self.path == "/api/v1/foods":
            self.answer(200, [])
        elif self.path in self.stub.items:
            name = "wrong" if self.stub.corrupt_reads else self.stub.items[self.path]
            self.answer(200, {"name": name})
        else:
            self.answer(404)

    def do_PUT(self) -> None:
        if not self.authorized():
            return
        length = int(self.headers["Content-Length"])
        self.stub.items[self.path] = json.loads(self.rfile.read(length))["name"]
        self.answer(201, {})

    def do_DELETE(self) -> None:
        if not self.authorized():
            return
        self.stub.deletes += 1
        self.stub.items.pop(self.path, None)
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


def test_passes_and_leaves_no_rows_behind(stub: Stub) -> None:
    run(stub.url, TOKEN)
    assert stub.items == {}


def test_never_prints_the_token(stub: Stub, capsys: pytest.CaptureFixture[str]) -> None:
    run(stub.url, TOKEN)
    assert TOKEN not in capsys.readouterr().out


def test_fails_when_the_token_check_is_off(stub: Stub) -> None:
    stub.enforce_token = False
    with pytest.raises(SmokeFailure, match="no token is refused"):
        run(stub.url, TOKEN)


def test_fails_on_a_bad_token(stub: Stub) -> None:
    with pytest.raises(SmokeFailure, match="token is accepted"):
        run(stub.url, "not-the-token")


def test_cleans_up_when_the_read_back_is_wrong(stub: Stub) -> None:
    stub.corrupt_reads = True
    with pytest.raises(SmokeFailure, match="wrong name"):
        run(stub.url, TOKEN)
    assert stub.deletes == 1
    assert stub.items == {}
