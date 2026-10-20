import datetime as dt
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

Unit = Literal["g", "count"]


class MealItemIn(BaseModel):
    id: UUID  # client-generated, makes retries safe
    food_id: UUID
    quantity: float = Field(ge=0.01, le=5000)  # required: no default
    unit: Unit = "g"


class MealCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    id: UUID  # client-generated, makes retries safe
    label: str | None = Field(default=None, min_length=1, max_length=50)
    foods: list[MealItemIn] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def unique_item_ids(self):
        ids = [f.id for f in self.foods]
        if len(ids) != len(set(ids)):
            raise ValueError("food entry ids must be unique within a meal")
        return self


class MealPatch(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    label: str = Field(min_length=1, max_length=50)


class ItemPatch(BaseModel):
    quantity: float = Field(ge=0.01, le=5000)


class Macros(BaseModel):
    calories: float
    protein_g: float
    fat_g: float
    carbs_g: float


class MealItemOut(BaseModel):
    id: UUID
    food_id: UUID
    name: str
    quantity: float
    unit: Unit
    calories: float
    protein_g: float
    fat_g: float
    carbs_g: float


class MealOut(BaseModel):
    id: UUID
    label: str
    position: int
    foods: list[MealItemOut]
    totals: Macros


class DayOut(BaseModel):
    date: dt.date
    meals: list[MealOut]
    day_totals: Macros


class DayTotalsOut(BaseModel):
    date: dt.date
    meal_count: int
    totals: Macros
