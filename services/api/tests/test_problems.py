from fastapi import HTTPException
from fastapi.testclient import TestClient

from health_api.main import create_app
from health_api.problems import PROBLEM_MEDIA_TYPE


def boom() -> None:
    raise RuntimeError("secret detail")


def takes_a_number(limit: int) -> int:
    return limit


def conflict() -> None:
    raise HTTPException(409, detail={"similar": ["oats"]})


def unchanged() -> None:
    raise HTTPException(304)


def test_unknown_path_is_a_problem() -> None:
    response = TestClient(create_app()).get("/nope")

    assert response.status_code == 404
    assert response.headers["content-type"] == PROBLEM_MEDIA_TYPE
    assert response.json() == {
        "type": "about:blank",
        "title": "Not Found",
        "status": 404,
        "detail": "Not Found",
    }


def test_invalid_input_lists_field_errors() -> None:
    app = create_app()
    app.add_api_route("/numbers", takes_a_number)

    response = TestClient(app).get("/numbers", params={"limit": "many"})

    assert response.status_code == 422
    assert response.headers["content-type"] == PROBLEM_MEDIA_TYPE
    assert response.json()["errors"][0]["field"] == "query.limit"


def test_unhandled_error_hides_its_message() -> None:
    app = create_app()
    app.add_api_route("/boom", boom)

    response = TestClient(app, raise_server_exceptions=False).get("/boom")

    assert response.status_code == 500
    assert response.headers["content-type"] == PROBLEM_MEDIA_TYPE
    assert "secret detail" not in response.text


def test_non_text_detail_keeps_its_status() -> None:
    app = create_app()
    app.add_api_route("/conflict", conflict)

    response = TestClient(app, raise_server_exceptions=False).get("/conflict")

    assert response.status_code == 409
    assert response.headers["content-type"] == PROBLEM_MEDIA_TYPE


def test_no_body_status_sends_no_body() -> None:
    app = create_app()
    app.add_api_route("/unchanged", unchanged)

    response = TestClient(app).get("/unchanged")

    assert response.status_code == 304
    assert response.content == b""


def test_contract_documents_every_error_as_a_problem() -> None:
    app = create_app()
    app.add_api_route("/numbers", takes_a_number)

    schema = app.openapi()

    problem = {PROBLEM_MEDIA_TYPE: {"schema": {"$ref": "#/components/schemas/Problem"}}}
    assert schema["paths"]["/readyz"]["get"]["responses"]["503"]["content"] == problem
    assert schema["paths"]["/numbers"]["get"]["responses"]["422"]["content"] == problem
    assert "HTTPValidationError" not in schema["components"]["schemas"]
