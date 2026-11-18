"""The Food, Exercise and Restaurant Catalogs (ADR 0006, ADR 0008, ADR 0012).

The three share a table shape and every rule, so one router factory serves all of them and
a fix to the duplicate logic cannot reach only two. `Catalog` holds what differs.
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Annotated, Any, Literal, Self
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import (
    UUID7,
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StringConstraints,
    model_validator,
)
from sqlalchemy import Row, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from health_api.db import DbSession, violated_constraint
from health_api.entries import MAX_AMOUNT
from health_api.identity import CurrentUser
from health_api.problems import (
    EXACT_DUPLICATE,
    ITEM_IN_USE,
    NEAR_DUPLICATE,
    CatalogRef,
    Problem,
    ProblemError,
)

# Tuned on tests/name_pairs.py. ADR 0012 records the results and why.
WORD_SIMILARITY_THRESHOLD = 0.4
SIMILARITY_THRESHOLD = 0.5
# Under three characters a word has too few trigrams to score, so typeahead is prefix only.
MIN_FUZZY_QUERY_LENGTH = 3
MAX_SIMILAR = 5
# Profile loads a whole Catalog in one list call (ADR 0032). Still bounded: one response can
# never be bigger than this, however many items a User adds.
MAX_LIST_LIMIT = 1000
# Bounds the unique btree on lower(name), which raises on rows over about 2,700 bytes.
MAX_NAME_LENGTH = 200
# Postgres text cannot hold NUL. Rejecting it here makes that a 422, not a driver error.
NO_NUL = r"^[^\x00]*$"

RESTRICT_VIOLATION = "23001"


def normalize_name(value: str) -> str:
    return " ".join(value.split())


CatalogName = Annotated[
    str,
    AfterValidator(normalize_name),
    StringConstraints(min_length=1, max_length=MAX_NAME_LENGTH, pattern=NO_NUL),
]


# ADR 0023's bounds, as the CHECKs in migration 0003 hold them.
MAX_KCAL = 10_000
# Far below any real label. The database only asks for more than zero, but a Day total divides
# by the Basis, and a Basis near zero would push that total past what a float can hold.
MIN_BASIS_G = 0.001
MACROS = ("protein_g", "carbs_g", "fat_g")
NUTRITION_COLUMNS = ("basis_g", "kcal", *MACROS)
FOOD_COLUMNS = (*NUTRITION_COLUMNS, "piece_g")


# strict, as on every number here: the contract says number, so "1.5" is refused, not converted.
PieceWeight = Annotated[float, Field(gt=0, le=MAX_AMOUNT, allow_inf_nan=False, strict=True)]
Grams = Annotated[float, Field(ge=0, allow_inf_nan=False, strict=True)]


class Nutrition(BaseModel):
    """What a label prints: calories and macros for a Basis amount in grams (ADR 0023).

    One object, not five fields on the Food: the five are all set or all absent, and a
    nullable object says that in the schema itself. A partial one fails as a missing field.
    """

    model_config = ConfigDict(extra="forbid")

    basis_g: float = Field(ge=MIN_BASIS_G, le=MAX_AMOUNT, allow_inf_nan=False, strict=True)
    kcal: float = Field(ge=0, le=MAX_KCAL, allow_inf_nan=False, strict=True)
    protein_g: Grams
    carbs_g: Grams
    fat_g: Grams

    @model_validator(mode="after")
    def macros_fit_in_the_basis(self) -> Self:
        # Each on its own, as the CHECKs have it: 60 g of food cannot hold 70 g of protein.
        for macro in MACROS:
            if getattr(self, macro) > self.basis_g:
                raise ValueError(f"{macro} cannot be more than basis_g.")
        return self


class Food(CatalogRef):
    last_unit: Literal["g", "count"] | None = None
    last_quantity: float | None = None
    nutrition: Nutrition | None = None
    piece_g: PieceWeight | None = None


def food_from_row(row: Mapping[Any, Any]) -> Food:
    """Folds the five flat columns into the one `nutrition` object the contract shows."""
    fields = {key: value for key, value in row.items() if key not in NUTRITION_COLUMNS}
    nutrition = None
    if row["basis_g"] is not None:
        # numeric arrives as Decimal, which the strict fields refuse.
        nutrition = Nutrition(**{column: float(row[column]) for column in NUTRITION_COLUMNS})
    piece_g = None if row["piece_g"] is None else float(row["piece_g"])
    return Food.model_validate({**fields, "nutrition": nutrition, "piece_g": piece_g})


class PutItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: CatalogName
    allow_similar: StrictBool = False


class PatchItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: CatalogName | None = None
    archived: StrictBool | None = None
    allow_similar: StrictBool = False


class PutFood(PutItem):
    # Leaving either out clears it: a PUT replaces the whole Food.
    nutrition: Nutrition | None = None
    piece_g: PieceWeight | None = None


class PatchFood(PatchItem):
    # Unlike name, null means something here: it clears the value. Leaving the field out
    # keeps it, so the two are told apart by whether the field was sent at all.
    nutrition: Nutrition | None = None
    piece_g: PieceWeight | None = None


def food_values(body: PutFood | PatchFood, only_sent: bool) -> dict[str, float | None]:
    """The column values a Food write sets. `only_sent` leaves unsent fields out (PATCH)."""
    values: dict[str, float | None] = {}
    if not only_sent or "nutrition" in body.model_fields_set:
        for column in NUTRITION_COLUMNS:
            values[column] = None if body.nutrition is None else getattr(body.nutrition, column)
    if not only_sent or "piece_g" in body.model_fields_set:
        values["piece_g"] = body.piece_g
    return values


@dataclass(frozen=True)
class Catalog:
    table: str
    item: str
    label: str
    model: type[CatalogRef]
    # Registers PUT and PATCH, whose bodies differ: a Food has more to write than a name.
    add_writes: Callable[[APIRouter, Catalog], None]
    # One row: the item's newest use. `c` is the Catalog row. Sorted by (day, occurred_at),
    # not occurred_at alone, because that is the order the indexes hold (ADR 0012).
    last_use: str
    # What the table holds beyond the shared columns, and how a row becomes the model.
    columns: tuple[str, ...] = ()
    from_row: Callable[[Mapping[Any, Any]], CatalogRef] = CatalogRef.model_validate


def select_items(
    session: Session,
    catalog: Catalog,
    user: UUID,
    where: str,
    order: str = "c.id",
    limit: int = 1,
    **params: Any,
) -> list[CatalogRef]:
    """The one read path, so every response carries the same derived fields."""
    extra = "".join(f", c.{column}" for column in catalog.columns)
    rows = session.execute(
        text(
            f"""
            SELECT c.id, c.name, c.archived_at IS NOT NULL AS archived, u.*{extra}
            FROM {catalog.table} c
            LEFT JOIN LATERAL ({catalog.last_use}) u ON true
            WHERE c.user_id = :user AND {where}
            ORDER BY {order}
            LIMIT :limit
            """
        ),
        {"user": user, "limit": limit, **params},
    ).mappings()
    return [catalog.from_row(dict(row)) for row in rows]


def load_item(session: Session, catalog: Catalog, user: UUID, item_id: UUID) -> CatalogRef:
    items = select_items(session, catalog, user, "c.id = :id", id=item_id)
    if not items:
        raise HTTPException(404, f"{catalog.label} not found.")
    return items[0]


def escape_like(query: str) -> str:
    """Typed text as literal text inside a LIKE pattern, read with ESCAPE '\\'.

    A typed % or _ means itself. Unescaped, "%" would match every name. The backslash goes
    first, or the next two replaces would have their own backslashes doubled.
    """
    return query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def name_search(session: Session, query: str, name: str) -> tuple[str, str, dict[str, str]]:
    """How every typeahead matches and ranks typed text against the SQL column `name`.

    Returns the WHERE term, the ORDER BY terms and their parameters: prefix matches first,
    then the closest fuzzy matches, then by name.
    """
    escaped = escape_like(query)
    prefix = rf"lower({name}) LIKE lower(:prefix) ESCAPE '\'"
    match = prefix
    if len(query) >= MIN_FUZZY_QUERY_LENGTH:
        # The operator, not word_similarity() >= 0.4: only an operator can use the GIN index,
        # and it reads its threshold from this setting. LOCAL ends with the transaction.
        session.execute(
            text(f"SET LOCAL pg_trgm.word_similarity_threshold = {WORD_SIMILARITY_THRESHOLD}")
        )
        match = f"({prefix} OR lower(:q) <% lower({name}))"
    order = f"{prefix} DESC, word_similarity(lower(:q), lower({name})) DESC, lower({name})"
    return match, order, {"q": query, "prefix": f"{escaped}%"}


def suggest_items(
    session: Session, catalog: Catalog, user: UUID, q: str, limit: int, include_archived: bool
) -> list[CatalogRef]:
    visible = "true" if include_archived else "c.archived_at IS NULL"
    query = normalize_name(q)
    if not query:
        # NULLS LAST pads with never-used items, by name (ADR 0008).
        order = "u.day DESC NULLS LAST, u.occurred_at DESC NULLS LAST, lower(c.name), c.id"
        return select_items(session, catalog, user, visible, order, limit)

    match, order, params = name_search(session, query, "c.name")
    return select_items(
        session, catalog, user, f"{visible} AND {match}", f"{order}, c.id", limit, **params
    )


def find_exact(
    session: Session, catalog: Catalog, user: UUID, item_id: UUID, name: str
) -> CatalogRef | None:
    row = (
        session.execute(
            text(
                f"""
                SELECT id, name, archived_at IS NOT NULL AS archived
                FROM {catalog.table}
                WHERE user_id = :user AND lower(name) = lower(:name) AND id <> :id
                """
            ),
            {"user": user, "name": name, "id": item_id},
        )
        .mappings()
        .one_or_none()
    )
    return CatalogRef.model_validate(dict(row)) if row else None


def find_similar(
    session: Session, catalog: Catalog, user: UUID, item_id: UUID, name: str
) -> list[CatalogRef]:
    session.execute(text(f"SET LOCAL pg_trgm.similarity_threshold = {SIMILARITY_THRESHOLD}"))
    # Archived items count: the client offers to unarchive them instead of duplicating.
    rows = session.execute(
        text(
            f"""
            SELECT id, name, archived_at IS NOT NULL AS archived
            FROM {catalog.table}
            WHERE user_id = :user AND lower(name) % lower(:name) AND id <> :id
            ORDER BY similarity(lower(name), lower(:name)) DESC, lower(name), id
            LIMIT :limit
            """
        ),
        {"user": user, "name": name, "id": item_id, "limit": MAX_SIMILAR},
    ).mappings()
    return [CatalogRef.model_validate(dict(row)) for row in rows]


def exact_duplicate(catalog: Catalog, existing: CatalogRef | None) -> ProblemError:
    return ProblemError(
        409,
        type=EXACT_DUPLICATE,
        detail=f"A {catalog.label} with this name already exists.",
        existing=existing,
    )


def reject_duplicates(
    session: Session,
    catalog: Catalog,
    user: UUID,
    item_id: UUID,
    name: str,
    allow_similar: bool,
) -> None:
    """Excludes the item itself, or a retried PUT would be a duplicate of its first attempt."""
    existing = find_exact(session, catalog, user, item_id, name)
    if existing:
        raise exact_duplicate(catalog, existing)
    if allow_similar:
        return
    similar = find_similar(session, catalog, user, item_id, name)
    if similar:
        raise ProblemError(
            409,
            type=NEAR_DUPLICATE,
            detail=f"Similar {catalog.table} exist. Resend with allow_similar to create anyway.",
            similar=similar,
        )


def write_name(
    session: Session,
    catalog: Catalog,
    user: UUID,
    item_id: UUID,
    name: str,
    statement: str,
    values: Mapping[str, Any],
) -> Row[Any] | None:
    """Runs a write that sets a name and ends in RETURNING. The row, if it wrote one.

    reject_duplicates alone is not enough: two requests can both pass it before either
    writes. The unique index is what decides that race, so its error must become the same 409.
    """
    try:
        result = session.execute(
            text(statement), {"user": user, "id": item_id, "name": name, **values}
        )
    except IntegrityError as error:
        session.rollback()
        if violated_constraint(error) != f"{catalog.table}_user_name_key":
            raise
        raise exact_duplicate(catalog, find_exact(session, catalog, user, item_id, name)) from None
    return result.first()


def problems(*statuses: int) -> dict[int | str, dict[str, Any]]:
    descriptions = {404: "Missing, or not yours.", 409: "Conflicts with the current state."}
    return {status: {"model": Problem, "description": descriptions[status]} for status in statuses}


def put_item(
    session: Session,
    catalog: Catalog,
    user: UUID,
    item_id: UUID,
    body: PutItem,
    response: Response,
    values: Mapping[str, Any],
) -> CatalogRef:
    """PUT for any Catalog. `values` are the columns to set besides the name."""
    current = session.execute(
        text(
            f"""
            SELECT name FROM {catalog.table}
            WHERE id = :id AND user_id = :user
            FOR UPDATE
            """
        ),
        {"id": item_id, "user": user},
    ).scalar_one_or_none()
    if current == body.name:
        # A retry of a PUT that already landed: the name has nothing to check.
        if not values:
            return load_item(session, catalog, user, item_id)
    else:
        reject_duplicates(session, catalog, user, item_id, body.name, body.allow_similar)

    columns = "".join(f", {column}" for column in values)
    params = "".join(f", :{column}" for column in values)
    updates = "".join(f", {column} = EXCLUDED.{column}" for column in values)
    # ON CONFLICT covers two first attempts racing. Its WHERE is the ownership check: on
    # someone else's id it writes nothing and returns no row. old is Postgres 18: the row
    # before this write, absent on insert, so exactly one racer is told it created the item.
    written = write_name(
        session,
        catalog,
        user,
        item_id,
        body.name,
        f"""
        INSERT INTO {catalog.table} AS c (id, user_id, name{columns})
        VALUES (:id, :user, :name{params})
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name{updates}, updated_at = now()
        WHERE c.user_id = EXCLUDED.user_id
        RETURNING old.id IS NULL AS created
        """,
        values,
    )
    if written is None:
        raise HTTPException(404, f"{catalog.label} not found.")
    item = load_item(session, catalog, user, item_id)
    session.commit()
    if written.created:
        response.status_code = 201
    return item


def patch_item(
    session: Session,
    catalog: Catalog,
    user: UUID,
    item_id: UUID,
    body: PatchItem,
    values: Mapping[str, Any],
) -> CatalogRef:
    """PATCH for any Catalog. `values` are the columns to set besides name and archived."""
    current = load_item(session, catalog, user, item_id)
    if body.name is not None and body.name != current.name:
        reject_duplicates(session, catalog, user, item_id, body.name, body.allow_similar)
        write_name(
            session,
            catalog,
            user,
            item_id,
            body.name,
            f"""
            UPDATE {catalog.table} SET name = :name, updated_at = now()
            WHERE id = :id AND user_id = :user
            RETURNING id
            """,
            {},
        )
    if body.archived is not None and body.archived != current.archived:
        session.execute(
            text(
                f"""
                UPDATE {catalog.table}
                SET archived_at = CASE WHEN :archived THEN now() END, updated_at = now()
                WHERE id = :id AND user_id = :user
                """
            ),
            {"archived": body.archived, "id": item_id, "user": user},
        )
    if values:
        updates = ", ".join(f"{column} = :{column}" for column in values)
        session.execute(
            text(
                f"""
                UPDATE {catalog.table} SET {updates}, updated_at = now()
                WHERE id = :id AND user_id = :user
                """
            ),
            {**values, "id": item_id, "user": user},
        )
    item = load_item(session, catalog, user, item_id)
    session.commit()
    return item


def put_responses(catalog: Catalog) -> dict[int | str, dict[str, Any]]:
    return {201: {"model": catalog.model, "description": "Created."}, **problems(404, 409)}


def add_name_writes(router: APIRouter, catalog: Catalog) -> None:
    """PUT and PATCH for a Catalog whose items are a name and nothing else."""
    label = catalog.label

    @router.put(
        "/{item_id}",
        operation_id=f"put_{catalog.item}",
        response_model=catalog.model,
        description=f"Create a {label} at a client-generated UUIDv7, or replace its name.",
        responses=put_responses(catalog),
    )
    def put(
        item_id: UUID7, body: PutItem, response: Response, user: CurrentUser, session: DbSession
    ) -> CatalogRef:
        return put_item(session, catalog, user, item_id, body, response, {})

    @router.patch(
        "/{item_id}",
        operation_id=f"patch_{catalog.item}",
        response_model=catalog.model,
        description=f"Rename, archive or unarchive a {label}.",
        responses=problems(404, 409),
    )
    def patch(item_id: UUID, body: PatchItem, user: CurrentUser, session: DbSession) -> CatalogRef:
        return patch_item(session, catalog, user, item_id, body, {})


def add_food_writes(router: APIRouter, catalog: Catalog) -> None:
    """PUT and PATCH for Foods, which also carry Nutrition and Piece Weight (ADR 0023)."""

    @router.put(
        "/{item_id}",
        operation_id="put_food",
        response_model=Food,
        description="Create a Food at a client-generated UUIDv7, or replace the whole Food.",
        responses=put_responses(catalog),
    )
    def put(
        item_id: UUID7, body: PutFood, response: Response, user: CurrentUser, session: DbSession
    ) -> CatalogRef:
        values = food_values(body, only_sent=False)
        return put_item(session, catalog, user, item_id, body, response, values)

    @router.patch(
        "/{item_id}",
        operation_id="patch_food",
        response_model=Food,
        description="Rename, archive or unarchive a Food, or set its Nutrition and Piece Weight.",
        responses=problems(404, 409),
    )
    def patch(item_id: UUID, body: PatchFood, user: CurrentUser, session: DbSession) -> CatalogRef:
        values = food_values(body, only_sent=True)
        return patch_item(session, catalog, user, item_id, body, values)


def catalog_router(catalog: Catalog) -> APIRouter:
    router = APIRouter(prefix=f"/api/v1/{catalog.table}", tags=[catalog.table])
    label = catalog.label

    @router.get(
        "",
        operation_id=f"suggest_{catalog.table}",
        response_model=list[catalog.model],
        description=(
            f"Suggest {label} items: matches for q, or the most recently used when q is empty."
        ),
    )
    def suggest(
        user: CurrentUser,
        session: DbSession,
        q: Annotated[str, Query(max_length=MAX_NAME_LENGTH, pattern=NO_NUL)] = "",
        limit: Annotated[int, Query(ge=1, le=MAX_LIST_LIMIT)] = 10,
        include_archived: bool = False,
    ) -> list[CatalogRef]:
        return suggest_items(session, catalog, user, q, limit, include_archived)

    @router.get(
        "/{item_id}",
        operation_id=f"get_{catalog.item}",
        response_model=catalog.model,
        description=f"Read one {label}.",
        responses=problems(404),
    )
    def get_item(item_id: UUID, user: CurrentUser, session: DbSession) -> CatalogRef:
        return load_item(session, catalog, user, item_id)

    catalog.add_writes(router, catalog)

    @router.delete(
        "/{item_id}",
        operation_id=f"delete_{catalog.item}",
        status_code=204,
        description=f"Delete a never-used {label}. A used one must be archived instead.",
        responses=problems(409),
    )
    def delete_item(item_id: UUID, user: CurrentUser, session: DbSession) -> None:
        try:
            session.execute(
                text(f"DELETE FROM {catalog.table} WHERE id = :id AND user_id = :user"),
                {"id": item_id, "user": user},
            )
        except IntegrityError as error:
            session.rollback()
            if getattr(error.orig, "sqlstate", None) != RESTRICT_VIOLATION:
                raise
            # Asking the foreign key, not checking first: there is no gap to race through.
            raise ProblemError(
                409,
                type=ITEM_IN_USE,
                detail=f"This {label} is used by Entries. Archive it instead.",
            ) from None
        session.commit()

    return router


CATALOGS = (
    Catalog(
        table="foods",
        item="food",
        label="Food",
        model=Food,
        add_writes=add_food_writes,
        last_use="""
            SELECT m.day, m.occurred_at, e.unit AS last_unit, e.quantity AS last_quantity
            FROM food_entries e JOIN meals m ON m.id = e.meal_id
            WHERE e.user_id = c.user_id AND e.food_id = c.id
            ORDER BY m.day DESC, m.occurred_at DESC, e.id DESC
            LIMIT 1
        """,
        columns=FOOD_COLUMNS,
        from_row=food_from_row,
    ),
    Catalog(
        table="exercises",
        item="exercise",
        label="Exercise",
        model=CatalogRef,
        add_writes=add_name_writes,
        last_use="""
            SELECT e.day, e.occurred_at
            FROM exercise_entries e
            WHERE e.user_id = c.user_id AND e.exercise_id = c.id
            ORDER BY e.day DESC, e.occurred_at DESC
            LIMIT 1
        """,
    ),
    Catalog(
        table="restaurants",
        item="restaurant",
        label="Restaurant",
        model=CatalogRef,
        add_writes=add_name_writes,
        last_use="""
            SELECT m.day, m.occurred_at
            FROM meals m
            WHERE m.user_id = c.user_id AND m.restaurant_id = c.id
            ORDER BY m.day DESC, m.occurred_at DESC
            LIMIT 1
        """,
    ),
)
