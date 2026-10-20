from uuid import UUID, uuid4

from fastapi import APIRouter, Query, Response
from psycopg.errors import UniqueViolation

from ..db import pool
from ..errors import ApiError
from ..schemas.errors import ERROR_RESPONSES
from ..schemas.foods import FoodCreate, FoodOut, FoodUpdate

router = APIRouter(prefix="/foods", tags=["foods"], responses=ERROR_RESPONSES)

# Module-level constants only. User input never gets concatenated into SQL;
# values always go through %s placeholders.
COLUMNS = "id, name, basis, calories, protein_g, fat_g, carbs_g, archived, updated_at"
UPDATABLE = {"name", "basis", "calories", "protein_g", "fat_g", "carbs_g", "archived"}


def like_pattern(q: str) -> str:
    """Turn user text into a contains-pattern, escaping LIKE's own wildcards."""
    escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


@router.post("", response_model=FoodOut, status_code=201)
def create_food(body: FoodCreate):
    try:
        with pool.connection() as conn:
            row = conn.execute(
                "INSERT INTO foods (id, name, basis, calories, protein_g, fat_g, carbs_g) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING " + COLUMNS,
                (
                    uuid4(),
                    body.name,
                    body.basis,
                    body.calories,
                    body.protein_g,
                    body.fat_g,
                    body.carbs_g,
                ),
            ).fetchone()
    except UniqueViolation:
        raise ApiError(409, "duplicate_name", f"An active food named '{body.name}' already exists")
    return row


@router.get("", response_model=list[FoodOut])
def list_foods(
    q: str | None = None,
    include_archived: bool = False,
    limit: int = Query(50, ge=1, le=200),
):
    sql = "SELECT " + COLUMNS + " FROM foods WHERE true"
    params: list = []
    if q:
        sql += " AND name ILIKE %s"
        params.append(like_pattern(q))
    if not include_archived:
        sql += " AND NOT archived"
    sql += " ORDER BY lower(name) LIMIT %s"
    params.append(limit)
    with pool.connection() as conn:
        return conn.execute(sql, params).fetchall()


@router.get("/{food_id}", response_model=FoodOut)
def get_food(food_id: UUID):
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT " + COLUMNS + " FROM foods WHERE id = %s", (food_id,)
        ).fetchone()
    if row is None:
        raise ApiError(404, "not_found", "Food not found")
    return row


@router.patch("/{food_id}", response_model=FoodOut)
def update_food(food_id: UUID, body: FoodUpdate):
    # Only the fields the client actually sent.
    changes = body.model_dump(exclude_unset=True)
    # Column names in the SQL come from this whitelist, never from user input.
    assert set(changes) <= UPDATABLE
    assignments = ", ".join(col + " = %s" for col in changes)
    params = list(changes.values()) + [food_id]
    try:
        with pool.connection() as conn:
            row = conn.execute(
                "UPDATE foods SET " + assignments + ", updated_at = now() "
                "WHERE id = %s RETURNING " + COLUMNS,
                params,
            ).fetchone()
    except UniqueViolation:
        raise ApiError(409, "duplicate_name", "An active food with that name already exists")
    if row is None:
        raise ApiError(404, "not_found", "Food not found")
    return row


@router.delete("/{food_id}", status_code=204)
def archive_food(food_id: UUID):
    # Soft delete: old meals reference foods, so the row must stay.
    # Idempotent: archiving an already-archived or unknown id is still a 204.
    with pool.connection() as conn:
        conn.execute(
            "UPDATE foods SET archived = true, updated_at = now() "
            "WHERE id = %s AND NOT archived",
            (food_id,),
        )
    return Response(status_code=204)
