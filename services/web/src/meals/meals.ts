import type { components } from "../api/schema";
import type { CatalogItem, CatalogRef } from "../catalog/catalogs";
import { currentTimeZone, toRfc3339 } from "../lib/occurred";
import { UNKNOWN_TOTAL } from "../nutrition/totals";

export type FoodsMeal = components["schemas"]["FoodsMeal"];
export type RestaurantMeal = components["schemas"]["RestaurantMeal"];
export type Meal = FoodsMeal | RestaurantMeal;
export type MealPage = components["schemas"]["MealPage"];
export type PutMeal =
  | components["schemas"]["PutFoodsMeal"]
  | components["schemas"]["PutRestaurantMeal"];
export type Unit = components["schemas"]["FoodEntry"]["unit"];

// Mirror the API's bounds (ADR 0006, ADR 0034), so the form refuses what the server
// would.
const MAX_AMOUNT = 1_000_000;
export const MAX_RESTAURANTS = 10;

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
// It has no time: the sheet does not edit when a Meal happened (ADR 0008).
export interface MealDraft {
  kind: Meal["kind"];
  label: string;
  rows: FoodRow[];
  // In the order added, which is the order the API keeps (ADR 0034).
  restaurants: CatalogRef[];
}

export function draftOf(meal: Meal): MealDraft {
  return {
    kind: meal.kind,
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
    restaurants: meal.kind === "restaurant" ? meal.restaurants : [],
  };
}

export function emptyDraft(kind: Meal["kind"]): MealDraft {
  return { kind, label: "", rows: [], restaurants: [] };
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
  // When a new Meal happened: now, moved onto the viewed Day.
  defaultAt: Date;
}

// A new Meal happened at defaultAt, seconds kept so Meals logged in the same minute
// stay in order. A saved Meal keeps its instant and zone: an edit never moves it.
function occurrence({ saved, defaultAt }: BuildMeal) {
  return saved === null
    ? { occurred_at: toRfc3339(defaultAt), occurred_tz: currentTimeZone() }
    : { occurred_at: saved.occurred_at, occurred_tz: saved.occurred_tz };
}

// The Meal the draft describes, as the feed will show it before the server answers.
// Null while the draft is not a Meal the server would accept. `number` is not read:
// the feed numbers by position.
export function buildMeal(input: BuildMeal): Meal | null {
  const { id, day, draft } = input;
  const shared = {
    id,
    day,
    number: 0,
    label: draft.label.trim() === "" ? null : draft.label.trim(),
    ...occurrence(input),
  };
  if (draft.kind === "restaurant") {
    const [first, ...rest] = draft.restaurants;
    return first === undefined
      ? null
      : {
          ...shared,
          kind: "restaurant",
          restaurants: [first, ...rest],
          // The read type still requires the deprecated field until /api/v2.
          restaurant: first,
        };
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
  return { ...shared, kind: "foods", food_entries, total: UNKNOWN_TOTAL };
}

// The request body. Reads embed whole Catalog refs; writes send only their ids.
export function toPutMeal(meal: Meal): PutMeal {
  const fields = {
    label: meal.label,
    occurred_at: meal.occurred_at,
    occurred_tz: meal.occurred_tz,
  };
  return meal.kind === "restaurant"
    ? {
        ...fields,
        kind: "restaurant",
        restaurant_ids: meal.restaurants.map(({ id }) => id),
      }
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

// Oldest first, the order the API returns them, so an optimistic Meal the server
// has not stored yet already sits where it will land.
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

// One-tap Labels for the Meal sheet. Only a shortcut: the Label stays free text and
// the API accepts any.
export const LABEL_PRESETS = ["Lunch", "Dinner"];

// A Meal is called by its Label, or plain "Meal" without one. Two unlabelled Meals
// share the name; the feed's order tells them apart.
export const mealName = (label: string | null) => label ?? "Meal";
