import datetime as dt
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator


class WorkoutCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    id: UUID  # client-generated, makes retries safe
    started_at: AwareDatetime  # must include a UTC offset, e.g. 2026-10-12T17:30:00-07:00
    name: str | None = Field(default=None, min_length=1, max_length=100)
    notes: str | None = Field(default=None, max_length=500)


class WorkoutPatch(BaseModel):
    """Every field optional. Send null to clear name/notes, or ended_at to reopen."""

    model_config = ConfigDict(str_strip_whitespace=True)

    ended_at: AwareDatetime | None = None
    name: str | None = Field(default=None, min_length=1, max_length=100)
    notes: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def not_empty(self):
        if not self.model_fields_set:
            raise ValueError("no fields to update")
        return self


class SetIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    id: UUID  # client-generated, makes retries safe
    exercise_id: UUID  # must exist in /exercises and not be archived
    weight_lbs: float = Field(ge=0, le=2000)
    reps: int = Field(ge=1, le=1000)
    notes: str | None = Field(default=None, max_length=500)


class SetPatch(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    exercise_id: UUID | None = None
    weight_lbs: float | None = Field(default=None, ge=0, le=2000)
    reps: int | None = Field(default=None, ge=1, le=1000)
    notes: str | None = Field(default=None, max_length=500)  # null clears it

    @model_validator(mode="after")
    def check_fields(self):
        if not self.model_fields_set:
            raise ValueError("no fields to update")
        for name in ("exercise_id", "weight_lbs", "reps"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self


class SetOut(BaseModel):
    id: UUID
    position: int
    exercise_id: UUID
    exercise: str  # the exercise's current name
    weight_lbs: float
    reps: int
    notes: str | None


class WorkoutOut(BaseModel):
    id: UUID
    date: dt.date
    started_at: dt.datetime
    ended_at: dt.datetime | None
    name: str | None
    notes: str | None
    sets: list[SetOut]
