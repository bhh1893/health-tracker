"""The Food, Exercise and Restaurant Catalogs (ADR 0006, ADR 0008, ADR 0012).

The three share a table shape and every rule, so one router factory serves all of them and
a fix to the duplicate logic cannot reach only two. `Catalog` holds what differs.
"""

from dataclasses import dataclass
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import UUID7, AfterValidator, BaseModel, ConfigDict, StringConstraints
from sqlalchemy import Row, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from health_api.db import DbSession
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


class Food(CatalogRef):
    last_unit: Literal["g", "count"] | None = None
    last_quantity: float | None = None


class PutItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: CatalogName
    allow_similar: bool = False


class PatchItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: CatalogName | None = None
    archived: bool | None = None
    allow_similar: bool = False


@dataclass(frozen=True)
class Catalog:
    table: str
    item: str
    label: str
    model: type[CatalogRef]
    # One row: the item's newest use. `c` is the Catalog row. Sorted by (day, occurred_at),
    # not occurred_at alone, because that is the order the indexes hold (ADR 0012).
    last_use: str


CATALOGS = (
    Catalog(
        table="foods",
        item="food",
        label="Food",
        model=Food,
        last_use="""
            SELECT m.day, m.occurred_at, e.unit AS last_unit, e.quantity AS last_quantity
            FROM food_entries e JOIN meals m ON m.id = e.meal_id
            WHERE e.user_id = c.user_id AND e.food_id = c.id
            ORDER BY m.day DESC, m.occurred_at DESC, e.id DESC
            LIMIT 1
        """,
    ),
    Catalog(
        table="exercises",
        item="exercise",
        label="Exercise",
        model=CatalogRef,
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
        last_use="""
            SELECT m.day, m.occurred_at
            FROM meals m
            WHERE m.user_id = c.user_id AND m.restaurant_id = c.id
            ORDER BY m.day DESC, m.occurred_at DESC
            LIMIT 1
        """,
    ),
)


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
    rows = session.execute(
        text(
            f"""
            SELECT c.id, c.name, c.archived_at IS NOT NULL AS archived, u.*
            FROM {catalog.table} c
            LEFT JOIN LATERAL ({catalog.last_use}) u ON true
            WHERE c.user_id = :user AND {where}
            ORDER BY {order}
            LIMIT :limit
            """
        ),
        {"user": user, "limit": limit, **params},
    ).mappings()
    return [catalog.model.model_validate(dict(row)) for row in rows]


def load_item(session: Session, catalog: Catalog, user: UUID, item_id: UUID) -> CatalogRef:
    items = select_items(session, catalog, user, "c.id = :id", id=item_id)
    if not items:
        raise HTTPException(404, f"{catalog.label} not found.")
    return items[0]


def suggest_items(
    session: Session, catalog: Catalog, user: UUID, q: str, limit: int, include_archived: bool
) -> list[CatalogRef]:
    visible = "true" if include_archived else "c.archived_at IS NULL"
    query = normalize_name(q)
    if not query:
        # NULLS LAST pads with never-used items, by name (ADR 0008).
        order = "u.day DESC NULLS LAST, u.occurred_at DESC NULLS LAST, lower(c.name), c.id"
        return select_items(session, catalog, user, visible, order, limit)

    # A typed % or _ means itself. Unescaped, "%" would match the whole Catalog.
    escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    prefix = r"lower(c.name) LIKE lower(:prefix) ESCAPE '\'"
    match = prefix
    if len(query) >= MIN_FUZZY_QUERY_LENGTH:
        # The operator, not word_similarity() >= 0.4: only an operator can use the GIN index,
        # and it reads its threshold from this setting. LOCAL ends with the transaction.
        session.execute(
            text(f"SET LOCAL pg_trgm.word_similarity_threshold = {WORD_SIMILARITY_THRESHOLD}")
        )
        match = f"({prefix} OR lower(:q) <% lower(c.name))"
    order = f"{prefix} DESC, word_similarity(lower(:q), lower(c.name)) DESC, lower(c.name), c.id"
    return select_items(
        session,
        catalog,
        user,
        f"{visible} AND {match}",
        order,
        limit,
        q=query,
        prefix=f"{escaped}%",
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
    session: Session, catalog: Catalog, user: UUID, item_id: UUID, name: str, statement: str
) -> Row[Any] | None:
    """Runs a write that sets a name and ends in RETURNING. The row, if it wrote one.

    reject_duplicates alone is not enough: two requests can both pass it before either
    writes. The unique index is what decides that race, so its error must become the same 409.
    """
    try:
        result = session.execute(text(statement), {"user": user, "id": item_id, "name": name})
    except IntegrityError as error:
        session.rollback()
        constraint = getattr(getattr(error.orig, "diag", None), "constraint_name", None)
        if constraint != f"{catalog.table}_user_name_key":
            raise
        raise exact_duplicate(catalog, find_exact(session, catalog, user, item_id, name)) from None
    return result.first()


def problems(*statuses: int) -> dict[int | str, dict[str, Any]]:
    descriptions = {404: "Missing, or not yours.", 409: "Conflicts with the current state."}
    return {status: {"model": Problem, "description": descriptions[status]} for status in statuses}


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
        limit: Annotated[int, Query(ge=1, le=50)] = 10,
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

    @router.put(
        "/{item_id}",
        operation_id=f"put_{catalog.item}",
        response_model=catalog.model,
        description=f"Create a {label} at a client-generated UUIDv7, or replace its name.",
        responses={
            201: {"model": catalog.model, "description": "Created."},
            **problems(404, 409),
        },
    )
    def put_item(
        item_id: UUID7,
        body: PutItem,
        response: Response,
        user: CurrentUser,
        session: DbSession,
    ) -> CatalogRef:
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
        # A retry of a PUT that already landed: nothing to check, nothing to write.
        if current == body.name:
            return load_item(session, catalog, user, item_id)

        reject_duplicates(session, catalog, user, item_id, body.name, body.allow_similar)
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
            INSERT INTO {catalog.table} AS c (id, user_id, name)
            VALUES (:id, :user, :name)
            ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
            WHERE c.user_id = EXCLUDED.user_id
            RETURNING old.id IS NULL AS created
            """,
        )
        if written is None:
            raise HTTPException(404, f"{label} not found.")
        item = load_item(session, catalog, user, item_id)
        session.commit()
        if written.created:
            response.status_code = 201
        return item

    @router.patch(
        "/{item_id}",
        operation_id=f"patch_{catalog.item}",
        response_model=catalog.model,
        description=f"Rename, archive or unarchive a {label}.",
        responses=problems(404, 409),
    )
    def patch_item(
        item_id: UUID,
        body: PatchItem,
        user: CurrentUser,
        session: DbSession,
    ) -> CatalogRef:
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
        item = load_item(session, catalog, user, item_id)
        session.commit()
        return item

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
