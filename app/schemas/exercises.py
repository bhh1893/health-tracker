from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def _tidy(name: str) -> str:
    """Collapse inner whitespace so 'Front   Squat' and 'Front Squat' are the same name."""
    return " ".join(name.split())


class ExerciseCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=100)
    muscle_area: str | None = Field(default=None, max_length=200)  # free-text note

    @field_validator("name")
    @classmethod
    def tidy_name(cls, v: str) -> str:
        return _tidy(v)


class ExerciseUpdate(BaseModel):
    """PATCH body: every field optional. Send muscle_area: null to clear it."""

    model_config = ConfigDict(str_strip_whitespace=True)

    name: str | None = Field(default=None, min_length=1, max_length=100)
    muscle_area: str | None = Field(default=None, max_length=200)
    archived: bool | None = None

    @field_validator("name")
    @classmethod
    def tidy_name(cls, v: str | None) -> str | None:
        return None if v is None else _tidy(v)

    @model_validator(mode="after")
    def check_fields(self):
        if not self.model_fields_set:
            raise ValueError("no fields to update")
        for name in ("name", "archived"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self


class ExerciseOut(BaseModel):
    id: UUID
    name: str
    muscle_area: str | None
    archived: bool
    updated_at: datetime
