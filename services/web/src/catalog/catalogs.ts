import { api, unwrap } from "../api/client";
import type { components } from "../api/schema";
import { EXERCISE_DAYS_KEY, MEAL_DAYS_KEY } from "../history/queries";
import { DEFAULT_CATEGORY } from "./restaurantCategory";

export type CatalogRef = components["schemas"]["CatalogRef"];
export type Food = components["schemas"]["Food"];
export type Restaurant = components["schemas"]["Restaurant"];
// A Restaurant inside a Restaurant Meal: the reference plus its Category (ADR 0041).
export type RestaurantRef = components["schemas"]["RestaurantRef"];

// The API's bound on every Catalog name (services/api catalogs.py), so a form refuses
// a longer one in its own words before any request.
export const MAX_NAME_LENGTH = 200;

// Any row a Catalog returns. Its own endpoints add the Day it was last used, Foods
// add what was last eaten and their Nutrition (ADR 0008, ADR 0032), and Restaurants
// their Category (ADR 0041). The items inside a duplicate Problem are plain
// CatalogRefs, which is why the extras are optional.
export type CatalogItem = CatalogRef &
  Partial<
    Pick<components["schemas"]["CatalogItem"], "last_used_day"> &
      Pick<Food, "last_quantity" | "last_unit" | "nutrition"> &
      Pick<Restaurant, "category">
  >;

// `category` is sent only to Restaurants, the one Catalog that has it. Left out, a
// new Restaurant is ate out and a renamed one keeps its Category.
interface NewItem {
  id: string;
  name: string;
  allowSimilar: boolean;
  category?: Restaurant["category"];
}

export interface Rename {
  name: string;
  allowSimilar: boolean;
  category?: Restaurant["category"];
}

// The three Catalogs share one API shape (ADR 0006): list, read, create, rename,
// archive, delete. One object per Catalog lets the combobox, the Profile pages and the
// item sheet serve all three without knowing which. The paths stay literal, so
// openapi-fetch still type-checks each call.
export interface Catalog {
  // The cache key prefix. Entry writes invalidate it to reorder recents.
  key: string;
  label: string;
  // The Profile page's title and path (ADR 0032).
  plural: string;
  page: string;
  placeholder: string;
  // Cache key prefixes of the screens that show this Catalog's names inside Entries,
  // so a rename or an archive reaches them.
  shownIn: readonly string[];
  // Logging hides archived items; History and Profile show them on request.
  suggest: (
    q: string,
    limit: number,
    includeArchived: boolean,
  ) => Promise<CatalogItem[]>;
  get: (id: string) => Promise<CatalogItem>;
  create: (item: NewItem) => Promise<CatalogItem>;
  rename: (id: string, change: Rename) => Promise<CatalogItem>;
  setArchived: (id: string, archived: boolean) => Promise<CatalogItem>;
  remove: (id: string) => Promise<void>;
}

// Foods and Exercises refuse a field they do not have, so `category` never reaches them.
const renameBody = ({ name, allowSimilar }: Rename) => ({
  name,
  allow_similar: allowSimilar,
});
const archiveBody = (archived: boolean) => ({ archived, allow_similar: false });

export const exerciseCatalog: Catalog = {
  key: "exercises",
  label: "Exercise",
  plural: "Exercises",
  page: "/profile/exercises",
  placeholder: "Search Exercises",
  shownIn: ["exercise-entries", EXERCISE_DAYS_KEY],
  suggest: (q, limit, includeArchived) =>
    unwrap(
      api.GET("/api/v1/exercises", {
        params: { query: { q, limit, include_archived: includeArchived } },
      }),
    ),
  get: (id) =>
    unwrap(
      api.GET("/api/v1/exercises/{item_id}", {
        params: { path: { item_id: id } },
      }),
    ),
  create: ({ id, name, allowSimilar }) =>
    unwrap(
      api.PUT("/api/v1/exercises/{item_id}", {
        params: { path: { item_id: id } },
        body: { name, allow_similar: allowSimilar },
      }),
    ),
  rename: (id, change) =>
    unwrap(
      api.PATCH("/api/v1/exercises/{item_id}", {
        params: { path: { item_id: id } },
        body: renameBody(change),
      }),
    ),
  setArchived: (id, archived) =>
    unwrap(
      api.PATCH("/api/v1/exercises/{item_id}", {
        params: { path: { item_id: id } },
        body: archiveBody(archived),
      }),
    ),
  remove: (id) =>
    unwrap(
      api.DELETE("/api/v1/exercises/{item_id}", {
        params: { path: { item_id: id } },
      }),
    ),
};

export const foodCatalog: Catalog = {
  key: "foods",
  label: "Food",
  plural: "Foods",
  page: "/profile/foods",
  placeholder: "Search Foods",
  shownIn: ["meals", MEAL_DAYS_KEY],
  suggest: (q, limit, includeArchived) =>
    unwrap(
      api.GET("/api/v1/foods", {
        params: { query: { q, limit, include_archived: includeArchived } },
      }),
    ),
  get: (id) =>
    unwrap(
      api.GET("/api/v1/foods/{item_id}", {
        params: { path: { item_id: id } },
      }),
    ),
  create: ({ id, name, allowSimilar }) =>
    unwrap(
      api.PUT("/api/v1/foods/{item_id}", {
        params: { path: { item_id: id } },
        body: { name, allow_similar: allowSimilar },
      }),
    ),
  rename: (id, change) =>
    unwrap(
      api.PATCH("/api/v1/foods/{item_id}", {
        params: { path: { item_id: id } },
        body: renameBody(change),
      }),
    ),
  setArchived: (id, archived) =>
    unwrap(
      api.PATCH("/api/v1/foods/{item_id}", {
        params: { path: { item_id: id } },
        body: archiveBody(archived),
      }),
    ),
  remove: (id) =>
    unwrap(
      api.DELETE("/api/v1/foods/{item_id}", {
        params: { path: { item_id: id } },
      }),
    ),
};

export const restaurantCatalog: Catalog = {
  key: "restaurants",
  label: "Restaurant",
  plural: "Restaurants",
  page: "/profile/restaurants",
  placeholder: "Search Restaurants",
  shownIn: ["meals", MEAL_DAYS_KEY],
  suggest: (q, limit, includeArchived) =>
    unwrap(
      api.GET("/api/v1/restaurants", {
        params: { query: { q, limit, include_archived: includeArchived } },
      }),
    ),
  get: (id) =>
    unwrap(
      api.GET("/api/v1/restaurants/{item_id}", {
        params: { path: { item_id: id } },
      }),
    ),
  create: ({ id, name, allowSimilar, category }) =>
    unwrap(
      api.PUT("/api/v1/restaurants/{item_id}", {
        params: { path: { item_id: id } },
        // The contract marks a field with a default as required, as it does
        // allow_similar, so a new Restaurant sends the API's own default.
        body: {
          name,
          allow_similar: allowSimilar,
          category: category ?? DEFAULT_CATEGORY,
        },
      }),
    ),
  rename: (id, change) =>
    unwrap(
      api.PATCH("/api/v1/restaurants/{item_id}", {
        params: { path: { item_id: id } },
        body: {
          ...renameBody(change),
          ...(change.category && { category: change.category }),
        },
      }),
    ),
  setArchived: (id, archived) =>
    unwrap(
      api.PATCH("/api/v1/restaurants/{item_id}", {
        params: { path: { item_id: id } },
        body: archiveBody(archived),
      }),
    ),
  remove: (id) =>
    unwrap(
      api.DELETE("/api/v1/restaurants/{item_id}", {
        params: { path: { item_id: id } },
      }),
    ),
};

// In Profile's menu order (ADR 0032).
export const CATALOGS = [foodCatalog, restaurantCatalog, exerciseCatalog];
