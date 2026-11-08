import { api, unwrap } from "../api/client";
import type { components } from "../api/schema";

export type CatalogRef = components["schemas"]["CatalogRef"];
export type Food = components["schemas"]["Food"];

// Any row a Catalog search returns. Foods add what was last eaten (ADR 0008); the
// other Catalogs, and the items inside a duplicate Problem, are plain CatalogRefs.
export type CatalogItem = CatalogRef &
  Partial<Pick<Food, "last_quantity" | "last_unit">>;

interface NewItem {
  id: string;
  name: string;
  allowSimilar: boolean;
}

// The three Catalogs share one API shape (ADR 0006): suggest, create, unarchive.
// One object per Catalog lets CatalogComboBox serve all three without knowing which.
// The paths stay literal, so openapi-fetch still type-checks each call.
export interface Catalog {
  // The cache key prefix. Entry writes invalidate it to reorder recents.
  key: string;
  label: string;
  placeholder: string;
  // Logging hides archived items; Search shows them, since their history is real.
  suggest: (
    q: string,
    limit: number,
    includeArchived: boolean,
  ) => Promise<CatalogItem[]>;
  create: (item: NewItem) => Promise<CatalogItem>;
  unarchive: (id: string) => Promise<CatalogItem>;
}

const unarchived = { archived: false, allow_similar: false };

export const exerciseCatalog: Catalog = {
  key: "exercises",
  label: "Exercise",
  placeholder: "Search Exercises",
  suggest: (q, limit, includeArchived) =>
    unwrap(
      api.GET("/api/v1/exercises", {
        params: { query: { q, limit, include_archived: includeArchived } },
      }),
    ),
  create: ({ id, name, allowSimilar }) =>
    unwrap(
      api.PUT("/api/v1/exercises/{item_id}", {
        params: { path: { item_id: id } },
        body: { name, allow_similar: allowSimilar },
      }),
    ),
  unarchive: (id) =>
    unwrap(
      api.PATCH("/api/v1/exercises/{item_id}", {
        params: { path: { item_id: id } },
        body: unarchived,
      }),
    ),
};

export const foodCatalog: Catalog = {
  key: "foods",
  label: "Food",
  placeholder: "Search Foods",
  suggest: (q, limit, includeArchived) =>
    unwrap(
      api.GET("/api/v1/foods", {
        params: { query: { q, limit, include_archived: includeArchived } },
      }),
    ),
  create: ({ id, name, allowSimilar }) =>
    unwrap(
      api.PUT("/api/v1/foods/{item_id}", {
        params: { path: { item_id: id } },
        body: { name, allow_similar: allowSimilar },
      }),
    ),
  unarchive: (id) =>
    unwrap(
      api.PATCH("/api/v1/foods/{item_id}", {
        params: { path: { item_id: id } },
        body: unarchived,
      }),
    ),
};

export const restaurantCatalog: Catalog = {
  key: "restaurants",
  label: "Restaurant",
  placeholder: "Search Restaurants",
  suggest: (q, limit, includeArchived) =>
    unwrap(
      api.GET("/api/v1/restaurants", {
        params: { query: { q, limit, include_archived: includeArchived } },
      }),
    ),
  create: ({ id, name, allowSimilar }) =>
    unwrap(
      api.PUT("/api/v1/restaurants/{item_id}", {
        params: { path: { item_id: id } },
        body: { name, allow_similar: allowSimilar },
      }),
    ),
  unarchive: (id) =>
    unwrap(
      api.PATCH("/api/v1/restaurants/{item_id}", {
        params: { path: { item_id: id } },
        body: unarchived,
      }),
    ),
};
