from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

Basis = Literal["per_100g", "per_item"]

# Upper bound keeps values inside the numeric(8,2) column instead of a database error.
Macro = Field(ge=0, le=10_000)


class FoodCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=100)
    basis: Basis
    calories: float = Macro
    protein_g: float = Macro
    fat_g: float = Macro
    carbs_g: float = Macro


class FoodUpdate(BaseModel):
    """PATCH body: every field optional; only the fields the client sends are changed."""

    model_config = ConfigDict(str_strip_whitespace=True)

    name: str | None = Field(default=None, min_length=1, max_length=100)
    basis: Basis | None = None
    calories: float | None = Field(default=None, ge=0, le=10_000)
    protein_g: float | None = Field(default=None, ge=0, le=10_000)
    fat_g: float | None = Field(default=None, ge=0, le=10_000)
    carbs_g: float | None = Field(default=None, ge=0, le=10_000)
    archived: bool | None = None

    @model_validator(mode="after")
    def check_fields(self):
        if not self.model_fields_set:
            raise ValueError("no fields to update")
        for name in self.model_fields_set:
            if getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self


class FoodOut(BaseModel):
    id: UUID
    name: str
    basis: Basis
    calories: float
    protein_g: float
    fat_g: float
    carbs_g: float
    archived: bool
    updated_at: datetime
