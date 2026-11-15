"""Reference Foods: a curated list every deploy loads, read-only to `api` (ADR 0023).

The source of truth is data/reference_foods.csv, reviewed in PRs. The migration Job runs

    python -m health_api.reference_foods

after `alembic upgrade head`, as the owner role, to make the table match the file. `api`
itself only reads the table, for the typeahead that prefills a User's own Food.
"""

import csv
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query
from pydantic import BaseModel, ValidationError
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session

from health_api.catalogs import (
    FOOD_COLUMNS,
    MAX_NAME_LENGTH,
    NO_NUL,
    NUTRITION_COLUMNS,
    CatalogName,
    Nutrition,
    PieceWeight,
    name_search,
    normalize_name,
)
from health_api.db import DbSession, database_url
from health_api.identity import CurrentUser

CSV_PATH = Path(__file__).resolve().parents[2] / "data" / "reference_foods.csv"
CSV_COLUMNS = ("id", "name", *FOOD_COLUMNS)


class ReferenceFood(BaseModel):
    """Shaped like a Food's own fields, so "Fill from reference" copies them straight across."""

    id: UUID
    name: CatalogName
    nutrition: Nutrition
    piece_g: PieceWeight | None = None


class InvalidCsv(Exception):
    """The file cannot be loaded. Carries every problem found, one per line of the message."""

    def __init__(self, problems: list[str]) -> None:
        super().__init__("\n".join(problems))
        self.problems = problems


def parse_row(row: dict[str, str]) -> ReferenceFood:
    """One CSV row as a Reference Food, held to the same bounds as a User's Food."""
    numbers = {column: float(row[column]) for column in NUTRITION_COLUMNS}
    piece_g = float(row["piece_g"]) if row["piece_g"].strip() else None
    return ReferenceFood(
        id=UUID(row["id"].strip()),
        name=row["name"],
        nutrition=Nutrition(**numbers),
        piece_g=piece_g,
    )


def describe(error: Exception) -> str:
    if isinstance(error, ValidationError):
        return "; ".join(
            f"{'.'.join(str(part) for part in problem['loc'])}: {problem['msg']}"
            for problem in error.errors()
        )
    return str(error)


def read_csv(path: Path = CSV_PATH) -> list[ReferenceFood]:
    """Every row of the file, or InvalidCsv naming each bad line.

    Checked here, before anything touches the database: a file that fails in the migration
    Job stops a rollout, so CI runs this same function on every PR.
    """
    with path.open(newline="", encoding="utf-8") as file:
        reader = csv.DictReader(file, strict=True)
        if tuple(reader.fieldnames or ()) != CSV_COLUMNS:
            raise InvalidCsv([f"line 1: the header must be exactly {','.join(CSV_COLUMNS)}"])

        problems: list[str] = []
        foods: list[ReferenceFood] = []
        seen_ids: dict[UUID, int] = {}
        seen_names: dict[str, int] = {}
        try:
            for row in reader:
                line = reader.line_num
                # DictReader pads a short row with None and keeps a long row's extras under
                # the key None. Either way the row no longer lines up with the header.
                if None in row or None in row.values():
                    problems.append(f"line {line}: expected {len(CSV_COLUMNS)} columns")
                    continue
                try:
                    food = parse_row(row)
                except (ValueError, ValidationError) as error:
                    problems.append(f"line {line}: {describe(error)}")
                    continue

                # The table keys on id, so a repeat would silently overwrite the first row.
                if food.id in seen_ids:
                    problems.append(f"line {line}: id repeats line {seen_ids[food.id]}")
                seen_ids.setdefault(food.id, line)
                # Two rows a person cannot tell apart in the typeahead.
                name = food.name.lower()
                if name in seen_names:
                    problems.append(f"line {line}: name repeats line {seen_names[name]}")
                seen_names.setdefault(name, line)
                foods.append(food)
        except csv.Error as error:
            problems.append(f"line {reader.line_num}: {error}")

    if problems:
        raise InvalidCsv(problems)
    return foods


@dataclass(frozen=True)
class LoadResult:
    written: int
    deleted: int


def load_reference_foods(engine: Engine, foods: list[ReferenceFood]) -> LoadResult:
    """Makes the table match `foods`. One transaction, so a reader never sees it half done.

    Idempotent: the upsert's WHERE skips a row that already holds these values, so a second
    run writes nothing. That is what makes it safe to run on every deploy.
    """
    columns = ", ".join(("id", "name", *FOOD_COLUMNS))
    values = ", ".join(f":{column}" for column in ("id", "name", *FOOD_COLUMNS))
    changed = ("name", *FOOD_COLUMNS)
    updates = ", ".join(f"{column} = EXCLUDED.{column}" for column in changed)
    current = ", ".join(f"r.{column}" for column in changed)
    incoming = ", ".join(f"EXCLUDED.{column}" for column in changed)
    upsert = text(
        f"""
        INSERT INTO reference_foods AS r ({columns})
        VALUES ({values})
        ON CONFLICT (id) DO UPDATE SET {updates}
        WHERE ({current}) IS DISTINCT FROM ({incoming})
        RETURNING id
        """
    )
    written = 0
    with engine.begin() as connection:
        for food in foods:
            row = {"id": food.id, "name": food.name, "piece_g": food.piece_g}
            row.update(food.nutrition.model_dump())
            written += len(connection.execute(upsert, row).all())
        # Rows whose id left the file. Nothing points at this table (ADR 0023), so a delete
        # cannot orphan or be blocked by a User's data.
        deleted = connection.execute(
            text("DELETE FROM reference_foods WHERE id <> ALL(:ids)"),
            {"ids": [food.id for food in foods]},
        ).rowcount
    return LoadResult(written=written, deleted=deleted)


def select_reference_foods(session: Session, q: str, limit: int) -> list[ReferenceFood]:
    """Typeahead, ranked like Catalog suggestions. With no text there is no "recent": by name."""
    query = normalize_name(q)
    where, order, params = "true", "lower(r.name)", {}
    if query:
        where, order, params = name_search(session, query, "r.name")
    rows = session.execute(
        text(
            f"""
            SELECT r.id, r.name, {", ".join(f"r.{column}" for column in FOOD_COLUMNS)}
            FROM reference_foods r
            WHERE {where}
            ORDER BY {order}, r.id
            LIMIT :limit
            """
        ),
        {"limit": limit, **params},
    ).mappings()
    return [
        ReferenceFood(
            id=row["id"],
            name=row["name"],
            # numeric arrives as Decimal, which the strict fields refuse.
            nutrition=Nutrition(**{column: float(row[column]) for column in NUTRITION_COLUMNS}),
            piece_g=None if row["piece_g"] is None else float(row["piece_g"]),
        )
        for row in rows
    ]


def reference_foods_router() -> APIRouter:
    router = APIRouter(prefix="/api/v1/reference-foods", tags=["reference-foods"])

    @router.get(
        "",
        operation_id="suggest_reference_foods",
        response_model=list[ReferenceFood],
        description="Suggest Reference Foods matching q, to copy Nutrition into a Food.",
    )
    def suggest_reference_foods(
        # Not used in the query: the list is shared. Asked for so only a User may read it.
        user: CurrentUser,
        session: DbSession,
        q: Annotated[str, Query(max_length=MAX_NAME_LENGTH, pattern=NO_NUL)] = "",
        limit: Annotated[int, Query(ge=1, le=50)] = 10,
    ) -> list[ReferenceFood]:
        return select_reference_foods(session, q, limit)

    return router


def main() -> int:
    try:
        foods = read_csv(CSV_PATH)
    except InvalidCsv as error:
        print(f"{CSV_PATH.name} is not valid:\n{error}", file=sys.stderr)
        return 1
    engine = create_engine(database_url())
    result = load_reference_foods(engine, foods)
    engine.dispose()
    print(
        f"reference_foods: {len(foods)} in the file, "
        f"{result.written} written, {result.deleted} deleted"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
