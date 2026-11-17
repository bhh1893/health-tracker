import { http, HttpResponse } from "msw";

import type { Problem } from "./api/client";
import type { components, paths } from "./api/schema";

type ExerciseSuggestions =
  paths["/api/v1/exercises"]["get"]["responses"][200]["content"]["application/json"];
type Me = components["schemas"]["Me"];

// The signed-in User the app shell asks about on load (ADR 0021). Typed from the
// contract, so a schema change breaks compilation here (ADR 0014).
export function signedInAs(role: Me["role"]) {
  return http.get<never, never, Me>("*/api/me", () =>
    HttpResponse.json({ role, name: "Owner", restaurant_day_kcal: 2500 }),
  );
}

export const noSuggestions = http.get<never, never, ExerciseSuggestions>(
  "*/api/v1/exercises",
  () => HttpResponse.json([]),
);

type CatalogRef = components["schemas"]["CatalogRef"];
type ExerciseEntry = components["schemas"]["ExerciseEntry"];
type ExerciseEntryPage = components["schemas"]["ExerciseEntryPage"];
type PutExerciseEntry = components["schemas"]["PutExerciseEntry"];

export const emptyDay = http.get<never, never, ExerciseEntryPage>(
  "*/api/v1/exercise-entries",
  () => HttpResponse.json({ items: [], next_cursor: null }),
);

export const bench: CatalogRef = {
  id: "0190a000-0000-7000-8000-000000000001",
  name: "Bench Press",
  archived: false,
};

export function aSet(fields: Partial<ExerciseEntry> = {}): ExerciseEntry {
  return {
    id: "0190a000-0000-7000-8000-0000000000a1",
    day: "2026-11-02",
    number: 1,
    exercise: bench,
    reps: 5,
    weight_lb: 135,
    occurred_at: "2026-11-02T18:00:00+13:00",
    occurred_tz: "Pacific/Auckland",
    ...fields,
  };
}

// A small stand-in for `api`: it keeps what it is sent, so a test can reload the feed
// and see what the server would hold. `catalog` is what suggestions search.
export function fakeExerciseApi(
  seed: ExerciseEntry[] = [],
  catalog: CatalogRef[] = [bench],
) {
  const entries = new Map(seed.map((entry) => [entry.id, entry]));
  const puts: { id: string; body: PutExerciseEntry }[] = [];
  const queries: string[] = [];

  const handlers = [
    http.get<never, never, ExerciseEntryPage>(
      "*/api/v1/exercise-entries",
      ({ request }) => {
        const day = new URL(request.url).searchParams.get("from");
        const items = [...entries.values()].filter((e) => e.day === day);
        return HttpResponse.json({ items, next_cursor: null });
      },
    ),
    http.put<{ entry_id: string }, PutExerciseEntry, ExerciseEntry>(
      "*/api/v1/exercise-entries/:entry_id",
      async ({ request, params }) => {
        const body = await request.json();
        const id = params.entry_id;
        puts.push({ id, body });
        const exercise = catalog.find((e) => e.id === body.exercise_id);
        if (exercise === undefined) {
          throw new Error(`Unknown Exercise ${body.exercise_id}`);
        }
        const entry = aSet({
          id,
          exercise,
          reps: body.reps,
          weight_lb: body.weight_lb ?? null,
          occurred_at: body.occurred_at,
          occurred_tz: body.occurred_tz,
          day: body.occurred_at.slice(0, 10),
        });
        const created = !entries.has(id);
        entries.set(id, entry);
        return HttpResponse.json(entry, { status: created ? 201 : 200 });
      },
    ),
    http.delete<{ entry_id: string }>(
      "*/api/v1/exercise-entries/:entry_id",
      ({ params }) => {
        entries.delete(params.entry_id);
        return new HttpResponse(null, { status: 204 });
      },
    ),
    http.get<never, never, ExerciseSuggestions>(
      "*/api/v1/exercises",
      ({ request }) => {
        const q = new URL(request.url).searchParams.get("q") ?? "";
        queries.push(q);
        const found = catalog.filter(({ name }) =>
          name.toLowerCase().includes(q.toLowerCase()),
        );
        return HttpResponse.json(found);
      },
    ),
  ];

  return { handlers, entries, puts, queries };
}

type Food = components["schemas"]["Food"];
type PatchFood = components["schemas"]["PatchFood"];
type ReferenceFood = components["schemas"]["ReferenceFood"];
type Nutrition = components["schemas"]["Nutrition"];
type Meal =
  components["schemas"]["FoodsMeal"] | components["schemas"]["RestaurantMeal"];
type MealPage = components["schemas"]["MealPage"];
type PutMeal =
  | components["schemas"]["PutFoodsMeal"]
  | components["schemas"]["PutRestaurantMeal"];

export const oats: Food = {
  id: "0190a000-0000-7000-8000-000000000101",
  name: "Oats",
  archived: false,
  last_quantity: 80,
  last_unit: "g",
};

export const rolledOats: ReferenceFood = {
  id: "0190a000-0000-7000-8000-000000000301",
  name: "Rolled oats",
  nutrition: {
    basis_g: 100,
    kcal: 379,
    protein_g: 13,
    carbs_g: 68,
    fat_g: 6.5,
  },
  piece_g: null,
};

export const banana: Food = {
  id: "0190a000-0000-7000-8000-000000000102",
  name: "Banana",
  archived: false,
  last_quantity: null,
  last_unit: null,
};

export const cafe: CatalogRef = {
  id: "0190a000-0000-7000-8000-000000000201",
  name: "Corner Cafe",
  archived: false,
};

const ref = ({ id, name, archived }: CatalogRef): CatalogRef => ({
  id,
  name,
  archived,
});

// A Meal none of whose Foods has Nutrition yet, which is how every Meal starts.
const noTotal = {
  kcal: 0,
  protein_g: 0,
  carbs_g: 0,
  fat_g: 0,
  incomplete: true,
};

export function aMeal(fields: Partial<Meal> = {}): Meal {
  return {
    id: "0190a000-0000-7000-8000-0000000000c1",
    day: "2026-11-02",
    number: 1,
    label: null,
    occurred_at: "2026-11-02T08:00:00+13:00",
    occurred_tz: "Pacific/Auckland",
    kind: "foods",
    food_entries: [{ food: ref(oats), quantity: 80, unit: "g" }],
    total: noTotal,
    ...fields,
  } as Meal;
}

const LAST_FOOD_ENTRY = "urn:health-tracker:problem:last-food-entry";

// Stands in for `api`'s Meal and Food endpoints, keeping what it is sent. Like the real
// one, it refuses to empty a saved Meal (ADR 0006), so a test proves the sheet never
// asks, and refuses a partial Nutrition block (ADR 0023).
export function fakeMealApi(
  seed: Meal[] = [],
  seedFoods: Food[] = [oats, banana],
  restaurants: CatalogRef[] = [cafe],
  references: ReferenceFood[] = [rolledOats],
) {
  const meals = new Map(seed.map((meal) => [meal.id, meal]));
  const foodsById = new Map(seedFoods.map((food) => [food.id, food]));
  const foods = () => [...foodsById.values()];
  const puts: { id: string; body: PutMeal }[] = [];
  const patches: { id: string; body: PatchFood }[] = [];
  const search = <T extends { name: string }>(items: T[], request: Request) => {
    const q = new URL(request.url).searchParams.get("q") ?? "";
    return items.filter(({ name }) =>
      name.toLowerCase().includes(q.toLowerCase()),
    );
  };

  const handlers = [
    http.get<never, never, MealPage>("*/api/v1/meals", ({ request }) => {
      const day = new URL(request.url).searchParams.get("from");
      const items = [...meals.values()].filter((m) => m.day === day);
      return HttpResponse.json({ items, next_cursor: null });
    }),
    http.put<{ meal_id: string }, PutMeal, Meal | Problem>(
      "*/api/v1/meals/:meal_id",
      async ({ request, params }) => {
        const body = await request.json();
        const id = params.meal_id;
        puts.push({ id, body });
        const existing = meals.get(id);
        if (body.kind === "foods" && body.food_entries.length === 0) {
          return HttpResponse.json(
            {
              type: LAST_FOOD_ENTRY,
              title: "Conflict",
              status: existing ? 409 : 422,
            },
            { status: existing ? 409 : 422 },
          );
        }
        const shared = {
          id,
          day: body.occurred_at.slice(0, 10),
          number: 0,
          label: body.label ?? null,
          occurred_at: body.occurred_at,
          occurred_tz: body.occurred_tz,
        };
        const find = (items: CatalogRef[], wanted: string) => {
          const item = items.find((i) => i.id === wanted);
          if (item === undefined) {
            throw new Error(`Unknown Catalog item ${wanted}`);
          }
          return ref(item);
        };
        const meal: Meal =
          body.kind === "restaurant"
            ? {
                ...shared,
                kind: "restaurant",
                restaurant: find(restaurants, body.restaurant_id),
              }
            : {
                ...shared,
                kind: "foods",
                food_entries: body.food_entries.map((entry) => ({
                  food: find(foods(), entry.food_id),
                  quantity: entry.quantity,
                  unit: entry.unit,
                })),
                total: noTotal,
              };
        meals.set(id, meal);
        return HttpResponse.json(meal, { status: existing ? 200 : 201 });
      },
    ),
    http.delete<{ meal_id: string }>(
      "*/api/v1/meals/:meal_id",
      ({ params }) => {
        meals.delete(params.meal_id);
        return new HttpResponse(null, { status: 204 });
      },
    ),
    http.get("*/api/v1/foods", ({ request }) =>
      HttpResponse.json(search(foods(), request)),
    ),
    http.get<{ item_id: string }>("*/api/v1/foods/:item_id", ({ params }) => {
      const food = foodsById.get(params.item_id);
      return food
        ? HttpResponse.json(food)
        : HttpResponse.json(
            { type: "about:blank", title: "Not Found", status: 404 },
            { status: 404 },
          );
    }),
    http.patch<{ item_id: string }, PatchFood, Food | Problem>(
      "*/api/v1/foods/:item_id",
      async ({ request, params }) => {
        const body = await request.json();
        const id = params.item_id;
        patches.push({ id, body });
        const current = foodsById.get(id);
        if (current === undefined) {
          throw new Error(`Unknown Food ${id}`);
        }
        const nutrition = body.nutrition as
          Partial<Nutrition> | null | undefined;
        if (nutrition && Object.keys(nutrition).length < 5) {
          return HttpResponse.json(
            {
              type: "about:blank",
              title: "Unprocessable Content",
              status: 422,
            },
            { status: 422 },
          );
        }
        const food: Food = {
          ...current,
          ...(body.name != null && { name: body.name }),
          ...("nutrition" in body && { nutrition: body.nutrition ?? null }),
          ...("piece_g" in body && { piece_g: body.piece_g ?? null }),
        };
        foodsById.set(id, food);
        // A rename shows in every Meal that holds the Food, as the real join does.
        for (const meal of meals.values()) {
          if (meal.kind === "foods") {
            for (const entry of meal.food_entries) {
              if (entry.food.id === id) {
                entry.food = ref(food);
              }
            }
          }
        }
        return HttpResponse.json(food);
      },
    ),
    http.get("*/api/v1/reference-foods", ({ request }) =>
      HttpResponse.json(search(references, request)),
    ),
    http.get("*/api/v1/restaurants", ({ request }) =>
      HttpResponse.json(search(restaurants, request)),
    ),
  ];

  return { handlers, meals, foods: foodsById, puts, patches };
}
