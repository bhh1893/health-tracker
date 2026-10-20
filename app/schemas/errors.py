from pydantic import BaseModel


class ErrorDetail(BaseModel):
    field: str
    message: str


class ErrorBody(BaseModel):
    code: str
    message: str
    details: list[ErrorDetail] | None = None


class ErrorResponse(BaseModel):
    error: ErrorBody


# Attached to each router so the generated OpenAPI spec documents the real error shape.
ERROR_RESPONSES = {
    400: {"model": ErrorResponse, "description": "Validation failed or invalid reference"},
    404: {"model": ErrorResponse, "description": "Not found"},
    409: {"model": ErrorResponse, "description": "Conflict (duplicate name or idempotency conflict)"},
    503: {"model": ErrorResponse, "description": "Database unavailable"},
}
