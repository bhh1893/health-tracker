"""Reference Foods: the shipped CSV, the deploy-time load and the typeahead (ADR 0023)."""

from collections.abc import Iterator
from pathlib import Path
from typing import Any
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from migrate import SERVICE_DIR, plain_url
from sqlalchemy import URL, Engine, text
from sqlalchemy.exc import ProgrammingError

from health_api.reference_foods import (
    CSV_COLUMNS,
    CSV_PATH,
    InvalidCsv,
    ReferenceFood,
    load_reference_foods,
    main,
    read_csv,
)

HEADER = ",".join(CSV_COLUMNS)
EGG = "00000000-0000-4000-8000-000000000001"
RICE = "00000000-0000-4000-8000-000000000002"
EGG_ROW = f'{EGG},"Egg, whole",100,143,12.6,0.7,9.5,50'
RICE_ROW = f"{RICE},White rice,100,130,2.7,28.2,0.3,"


def write_csv(tmp_path: Path, *rows: str, header: str = HEADER) -> Path:
    path = tmp_path / "reference_foods.csv"
    path.write_text("\n".join([header, *rows]) + "\n", encoding="utf-8")
    return path


def food(food_id: str, name: str, **fields: Any) -> ReferenceFood:
    nutrition = {"basis_g": 100, "kcal": 100, "protein_g": 1, "carbs_g": 2, "fat_g": 3}
    return ReferenceFood.model_validate(
        {"id": food_id, "name": name, "nutrition": nutrition, **fields}
    )


def table(engine: Engine) -> list[tuple[Any, ...]]:
    with engine.connect() as connection:
        rows = connection.execute(
            text(
                "SELECT id, name, basis_g, kcal, protein_g, carbs_g, fat_g, piece_g, xmin "
                "FROM reference_foods ORDER BY name"
            )
        ).all()
    return [tuple(row) for row in rows]


@pytest.fixture
def clean_table(owner_engine: Engine) -> Iterator[Engine]:
    """The loader commits, as it must in the Job, so these tests clean up after themselves."""
    yield owner_engine
    with owner_engine.begin() as connection:
        connection.execute(text("DELETE FROM reference_foods"))


# The file.


def test_the_shipped_csv_is_valid() -> None:
    """The CI check: a malformed file fails here, in the PR, not in the migration Job."""
    foods = read_csv()

    assert len(foods) > 0


def test_the_image_ships_the_csv() -> None:
    dockerfile = (SERVICE_DIR / "Dockerfile").read_text()

    assert CSV_PATH == SERVICE_DIR / "data" / "reference_foods.csv"
    assert "COPY data ./data" in dockerfile


def test_a_row_is_read_as_typed(tmp_path: Path) -> None:
    egg, rice = read_csv(write_csv(tmp_path, EGG_ROW, RICE_ROW))

    assert egg.id == UUID(EGG)
    assert egg.name == "Egg, whole"
    assert egg.nutrition.model_dump() == {
        "basis_g": 100,
        "kcal": 143,
        "protein_g": 12.6,
        "carbs_g": 0.7,
        "fat_g": 9.5,
    }
    assert egg.piece_g == 50
    assert rice.piece_g is None


@pytest.mark.parametrize(
    ("rows", "problem"),
    [
        ([f"{EGG},Egg,100,143,12.6,0.7,9.5"], "line 2: expected 8 columns"),
        ([f"{EGG},Egg,100,143,12.6,0.7,9.5,50,extra"], "line 2: expected 8 columns"),
        ([f"{EGG},Egg, whole,100,143,12.6,0.7,9.5,50"], "line 2: expected 8 columns"),
        (["not-a-uuid,Egg,100,143,12.6,0.7,9.5,50"], "line 2: badly formed"),
        ([f"{EGG},,100,143,12.6,0.7,9.5,50"], "line 2: name"),
        ([f"{EGG},Egg,100,many,12.6,0.7,9.5,50"], "line 2: could not convert"),
        ([f"{EGG},Egg,100,,12.6,0.7,9.5,50"], "line 2: could not convert"),
        ([f"{EGG},Egg,0,143,12.6,0.7,9.5,50"], "line 2: basis_g: Input should be greater"),
        ([f"{EGG},Egg,100,10001,12.6,0.7,9.5,50"], "line 2: kcal: Input should be less"),
        ([f"{EGG},Egg,100,143,-1,0.7,9.5,50"], "line 2: protein_g: Input should be greater"),
        ([f"{EGG},Egg,100,143,12.6,101,9.5,50"], "carbs_g cannot be more than basis_g"),
        ([f"{EGG},Egg,100,143,12.6,0.7,9.5,0"], "line 2: piece_g"),
        ([f"{EGG},Egg,100,143,nan,0.7,9.5,50"], "line 2: protein_g: Input should be a finite"),
        ([EGG_ROW, f"{EGG},Other,100,1,1,1,1,"], "line 3: id repeats line 2"),
        ([EGG_ROW, f"{RICE},egg,   WHOLE,100,1,1,1,1,"], "line 3: expected 8 columns"),
        ([EGG_ROW, f'{RICE},"egg,   WHOLE",100,1,1,1,1,'], "line 3: name repeats line 2"),
    ],
)
def test_a_malformed_csv_is_refused(tmp_path: Path, rows: list[str], problem: str) -> None:
    with pytest.raises(InvalidCsv) as caught:
        read_csv(write_csv(tmp_path, *rows))

    assert problem in str(caught.value)


@pytest.mark.parametrize(
    "header",
    [
        "id,name,basis_g,kcal,protein_g,carbs_g,fat_g",
        "id,name,kcal,basis_g,protein_g,carbs_g,fat_g,piece_g",
        "ID,name,basis_g,kcal,protein_g,carbs_g,fat_g,piece_g",
        "",
    ],
)
def test_the_header_must_match_exactly(tmp_path: Path, header: str) -> None:
    with pytest.raises(InvalidCsv, match="line 1: the header must be exactly"):
        read_csv(write_csv(tmp_path, EGG_ROW, header=header))


def test_every_bad_line_is_reported_at_once(tmp_path: Path) -> None:
    path = write_csv(tmp_path, "junk", EGG_ROW, f"{RICE},Rice,100,99999,1,1,1,")

    with pytest.raises(InvalidCsv) as caught:
        read_csv(path)

    assert [problem.split(":")[0] for problem in caught.value.problems] == ["line 2", "line 4"]


# The load.


def test_load_fills_the_table(clean_table: Engine) -> None:
    result = load_reference_foods(clean_table, [food(EGG, "Egg", piece_g=50), food(RICE, "Rice")])

    assert (result.written, result.deleted) == (2, 0)
    assert [(row[1], row[7]) for row in table(clean_table)] == [("Egg", 50), ("Rice", None)]


def test_a_second_load_changes_nothing(clean_table: Engine) -> None:
    """Idempotent. xmin is the transaction that last wrote a row: unchanged means untouched."""
    foods = [food(EGG, "Egg"), food(RICE, "Rice")]
    load_reference_foods(clean_table, foods)
    before = table(clean_table)

    result = load_reference_foods(clean_table, foods)

    assert (result.written, result.deleted) == (0, 0)
    assert table(clean_table) == before


def test_a_removed_row_is_deleted(clean_table: Engine) -> None:
    load_reference_foods(clean_table, [food(EGG, "Egg"), food(RICE, "Rice")])

    result = load_reference_foods(clean_table, [food(RICE, "Rice")])

    assert (result.written, result.deleted) == (0, 1)
    assert [row[1] for row in table(clean_table)] == ["Rice"]


def test_an_edited_row_is_updated_in_place(clean_table: Engine) -> None:
    load_reference_foods(clean_table, [food(EGG, "Egg"), food(RICE, "Rice")])
    rice_before = table(clean_table)[1]

    result = load_reference_foods(
        clean_table, [food(EGG, "Egg, whole", piece_g=50), food(RICE, "Rice")]
    )

    assert (result.written, result.deleted) == (1, 0)
    egg, rice = table(clean_table)
    assert (egg[0], egg[1], egg[7]) == (UUID(EGG), "Egg, whole", 50)
    assert rice == rice_before


def test_an_empty_file_empties_the_table(clean_table: Engine) -> None:
    load_reference_foods(clean_table, [food(EGG, "Egg")])

    result = load_reference_foods(clean_table, [])

    assert result.deleted == 1
    assert table(clean_table) == []


def test_a_failed_load_changes_nothing(clean_table: Engine) -> None:
    """One transaction: a bad row cannot leave the table half loaded."""
    load_reference_foods(clean_table, [food(EGG, "Egg")])
    before = table(clean_table)
    # Built without validation, to stand in for a row the database refuses.
    bad = food(RICE, "Rice").model_copy(update={"piece_g": -1})

    with pytest.raises(Exception, match="reference_foods_piece_g_positive"):
        load_reference_foods(clean_table, [food(EGG, "Egg, renamed"), bad])

    assert table(clean_table) == before


def test_api_rw_cannot_load(api_rw_engine: Engine) -> None:
    """Why the load runs in the migration Job as `app`, not from `api` (ADR 0023)."""
    with pytest.raises(ProgrammingError, match="permission denied"):
        load_reference_foods(api_rw_engine, [food(EGG, "Egg")])


def test_the_command_loads_the_shipped_csv(
    clean_table: Engine,
    role_urls: dict[str, URL],
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """As the migration Job runs it: DATABASE_URL for the owner role, exit code 0."""
    monkeypatch.setenv("DATABASE_URL", plain_url(role_urls["app"]))
    shipped = len(read_csv())

    assert main() == 0
    assert main() == 0

    assert len(table(clean_table)) == shipped
    first, second = capsys.readouterr().out.splitlines()
    assert first == f"reference_foods: {shipped} in the file, {shipped} written, 0 deleted"
    assert second == f"reference_foods: {shipped} in the file, 0 written, 0 deleted"


def test_the_command_fails_on_a_bad_csv_before_connecting(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr("health_api.reference_foods.CSV_PATH", write_csv(tmp_path, "junk"))
    monkeypatch.delenv("DATABASE_URL", raising=False)

    assert main() == 1
    assert "line 2: expected 8 columns" in capsys.readouterr().err


# The typeahead.

SUGGEST = "/api/v1/reference-foods"


@pytest.fixture
def reference_foods(clean_table: Engine) -> None:
    names = [
        "Chicken breast",
        "Chicken thigh",
        "Roast chicken",
        "Chickpeas",
        "Egg",
        "Rice, white",
        "100% juice",
    ]
    load_reference_foods(
        clean_table,
        [
            food(f"00000000-0000-4000-8000-0000000000{index:02}", name)
            for index, name in enumerate(names)
        ],
    )


def suggested(client: TestClient, **params: Any) -> list[str]:
    response = client.get(SUGGEST, params=params)
    assert response.status_code == 200, response.text
    return [item["name"] for item in response.json()]


@pytest.mark.usefixtures("reference_foods")
def test_suggestions_rank_like_the_catalogs(client: TestClient) -> None:
    """Prefix matches first, then a match inside the name, then a merely similar word."""
    assert suggested(client, q="chicken") == [
        "Chicken breast",
        "Chicken thigh",
        "Roast chicken",
        "Chickpeas",
    ]


@pytest.mark.usefixtures("reference_foods")
def test_suggestions_forgive_a_typo(client: TestClient) -> None:
    assert suggested(client, q="chiken")[:2] == ["Chicken breast", "Chicken thigh"]


@pytest.mark.usefixtures("reference_foods")
def test_a_short_query_is_prefix_only(client: TestClient) -> None:
    assert suggested(client, q="ch") == ["Chicken breast", "Chicken thigh", "Chickpeas"]


@pytest.mark.usefixtures("reference_foods")
def test_no_query_lists_by_name(client: TestClient) -> None:
    assert suggested(client, limit=3) == ["100% juice", "Chicken breast", "Chicken thigh"]


@pytest.mark.usefixtures("reference_foods")
def test_a_typed_wildcard_means_itself(client: TestClient) -> None:
    assert suggested(client, q="%") == []
    assert suggested(client, q="100%") == ["100% juice"]


@pytest.mark.usefixtures("reference_foods")
def test_suggestions_carry_what_fill_from_reference_copies(client: TestClient) -> None:
    [egg] = client.get(SUGGEST, params={"q": "egg"}).json()

    assert egg == {
        "id": "00000000-0000-4000-8000-000000000004",
        "name": "Egg",
        "nutrition": {"basis_g": 100, "kcal": 100, "protein_g": 1, "carbs_g": 2, "fat_g": 3},
        "piece_g": None,
    }


@pytest.mark.usefixtures("reference_foods")
def test_a_reference_food_fills_a_food_as_it_is(client: TestClient) -> None:
    """Copy-on-pick: what the typeahead returns is a valid body for the User's own Food."""
    [egg] = client.get(SUGGEST, params={"q": "egg"}).json()
    mine = "019a0000-0000-7000-8000-00000000abcd"
    client.put(f"/api/v1/foods/{mine}", json={"name": "My eggs"}).raise_for_status()

    patched = client.patch(
        f"/api/v1/foods/{mine}", json={"nutrition": egg["nutrition"], "piece_g": egg["piece_g"]}
    )

    assert patched.status_code == 200, patched.text
    assert patched.json()["nutrition"] == egg["nutrition"]


@pytest.mark.parametrize("limit", [0, 51])
def test_limit_is_bounded(client: TestClient, limit: int) -> None:
    assert client.get(SUGGEST, params={"limit": limit}).status_code == 422


def test_reference_foods_cannot_be_written_through_the_api(client: TestClient) -> None:
    assert client.post(SUGGEST, json={}).status_code == 405
    assert client.put(f"{SUGGEST}/{EGG}", json={}).status_code in (404, 405)
