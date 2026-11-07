import type { components } from "../api/schema";
import type { CatalogItem, CatalogRef } from "../catalog/catalogs";
import {
  currentTimeZone,
  onDay,
  timeOfDay,
  toRfc3339,
  withClockTime,
} from "../lib/occurred";

export type FoodsMeal = components["schemas"]["FoodsMeal"];
export type RestaurantMeal = components["schemas"]["RestaurantMeal"];
export type Meal = FoodsMeal | RestaurantMeal;
export type MealPage = components["schemas"]["MealPage"];
export type PutMeal =
  | components["schemas"]["PutFoodsMeal"]
  | components["schemas"]["PutRestaurantMeal"];
export type Unit = components["schemas"]["FoodEntry"]["unit"];

// Mirrors the API's bound (ADR 0006), so the form refuses what the server would.
const MAX_AMOUNT = 1_000_000;

// One Food Entry as the sheet edits it. `quantity` is the input's text: "", "1." and
// "0" are all things a user passes through while typing, and none is a valid number.
// `key` is local: a Meal may hold the same Food twice, so the Food id cannot be it.
export interface FoodRow {
  key: string;
  food: CatalogRef;
  quantity: string;
  unit: Unit;
}

// The whole Meal as the sheet holds it while editing. The client owns this state
// and always sends all of it (ADR 0006): the Meal is an aggregate, written whole.
export interface MealDraft {
  kind: Meal["kind"];
  time: string;
  label: string;
  rows: FoodRow[];
  restaurant: CatalogRef | null;
}

// occurred_at is written in the Meal's own zone, so these are the clock digits it
// happened at, wherever the phone is now.
export const clockTime = (meal: Meal) => meal.occurred_at.slice(11, 16);

export function draftOf(meal: Meal): MealDraft {
  return {
    kind: meal.kind,
    time: clockTime(meal),
    label: meal.label ?? "",
    rows:
      meal.kind === "foods"
        ? meal.food_entries.map((entry, index) => ({
            key: String(index),
            food: entry.food,
            quantity: String(entry.quantity),
            unit: entry.unit,
          }))
        : [],
    restaurant: meal.kind === "restaurant" ? meal.restaurant : null,
  };
}

export function emptyDraft(time: string): MealDraft {
  return { kind: "foods", time, label: "", rows: [], restaurant: null };
}

// A Food just added from search, prefilled with what was eaten last time (ADR 0008).
export function rowFor(key: string, food: CatalogItem): FoodRow {
  return {
    key,
    food: { id: food.id, name: food.name, archived: food.archived },
    quantity: food.last_quantity?.toString() ?? "",
    unit: food.last_unit ?? "g",
  };
}

export function parseQuantity(text: string) {
  const value = Number(text);
  return text.trim() !== "" && value > 0 && value <= MAX_AMOUNT ? value : null;
}

interface BuildMeal {
  id: string;
  day: string;
  draft: MealDraft;
  // The server's version, when editing. Null for a new Meal.
  saved: Meal | null;
  // When a new Meal happened if the time is left as it was prefilled.
  defaultAt: Date;
}

function occurrence({ day, draft, saved, defaultAt }: BuildMeal) {
  if (saved === null) {
    // Untouched, keep the seconds, so Meals logged in the same minute stay in order.
    const at =
      draft.time === timeOfDay(defaultAt) ? defaultAt : onDay(day, draft.time);
    return { occurred_at: toRfc3339(at), occurred_tz: currentTimeZone() };
  }
  if (draft.time === clockTime(saved)) {
    return { occurred_at: saved.occurred_at, occurred_tz: saved.occurred_tz };
  }
  return {
    occurred_at: withClockTime(
      saved.occurred_at,
      saved.occurred_tz,
      draft.time,
    ),
    occurred_tz: saved.occurred_tz,
  };
}

// The Meal the draft describes, as the feed will show it before the server answers.
// Null while the draft is not a Meal the server would accept. `number` is not read:
// the feed numbers by position.
export function buildMeal(input: BuildMeal): Meal | null {
  const { id, day, draft } = input;
  if (draft.time === "") {
    return null;
  }
  const shared = {
    id,
    day,
    number: 0,
    label: draft.label.trim() === "" ? null : draft.label.trim(),
    ...occurrence(input),
  };
  if (draft.kind === "restaurant") {
    return draft.restaurant === null
      ? null
      : { ...shared, kind: "restaurant", restaurant: draft.restaurant };
  }
  const entries = draft.rows.map((row) => ({
    food: row.food,
    quantity: parseQuantity(row.quantity),
    unit: row.unit,
  }));
  if (entries.length === 0) {
    return null;
  }
  const food_entries = [];
  for (const { quantity, ...entry } of entries) {
    if (quantity === null) {
      return null;
    }
    food_entries.push({ ...entry, quantity });
  }
  return { ...shared, kind: "foods", food_entries };
}

// The request body. Reads embed whole Catalog refs; writes send only their ids.
export function toPutMeal(meal: Meal): PutMeal {
  const fields = {
    label: meal.label,
    occurred_at: meal.occurred_at,
    occurred_tz: meal.occurred_tz,
  };
  return meal.kind === "restaurant"
    ? { ...fields, kind: "restaurant", restaurant_id: meal.restaurant.id }
    : {
        ...fields,
        kind: "foods",
        food_entries: meal.food_entries.map(({ food, quantity, unit }) => ({
          food_id: food.id,
          quantity,
          unit,
        })),
      };
}

function byOccurrence(a: Meal, b: Meal) {
  const difference = Date.parse(a.occurred_at) - Date.parse(b.occurred_at);
  return difference !== 0 ? difference : a.id.localeCompare(b.id);
}

// Oldest first, in the order the API numbers them, so a Meal's position is its
// number even for an optimistic Meal the server has not numbered yet.
export function sortMeals(meals: Meal[]) {
  return meals.toSorted(byOccurrence);
}

export function formatAmount({
  quantity,
  unit,
}: {
  quantity: number;
  unit: Unit;
}) {
  return unit === "g" ? `${String(quantity)} g` : `× ${String(quantity)}`;
}

export const mealName = (number: number, label: string | null) =>
  label === null
    ? `Meal ${String(number)}`
    : `Meal ${String(number)}, ${label}`;
