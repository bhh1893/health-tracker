import type { CatalogItem } from "./catalogs";
import { parseCategory, type RestaurantCategory } from "./restaurantCategory";

// A Profile Catalog page's filters (ADR 0032). They live in the URL, so Back and the
// Profile tab's memory bring the list back as it was.
export interface CatalogFilters {
  // Name contains this, case-insensitive. Kept as typed, so the box shows it.
  q: string;
  // Show archived items too. The page then asks the API for them.
  archived: boolean;
  // Foods only: just those with no Nutrition yet.
  missing: boolean;
  // Restaurants only: just those of this Category (ADR 0041), or null for all.
  category: RestaurantCategory | null;
}

// What a Catalog's items have, so a filter it cannot have is ignored rather than
// hiding every row: ?missing=1 on Restaurants, ?category= on Foods.
interface Has {
  nutrition: boolean;
  category: boolean;
}

export function parseFilters(
  params: URLSearchParams,
  has: Has,
): CatalogFilters {
  return {
    q: params.get("q") ?? "",
    archived: params.get("archived") === "1",
    missing: has.nutrition && params.get("missing") === "1",
    category: has.category ? parseCategory(params.get("category")) : null,
  };
}

// Defaults are left out, so an unfiltered page has a bare URL.
export function toSearchParams({
  q,
  archived,
  missing,
  category,
}: CatalogFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (q !== "") {
    params.set("q", q);
  }
  if (archived) {
    params.set("archived", "1");
  }
  if (missing) {
    params.set("missing", "1");
  }
  if (category !== null) {
    params.set("category", category);
  }
  return params;
}

// Spaces collapse as the API's own names do, so "bench  press" still finds
// "Bench Press".
const normalize = (text: string) =>
  text.trim().split(/\s+/).join(" ").toLowerCase();

// All filters must hold. A plain substring, not the API's fuzzy ranking: "chiken"
// finds nothing here (ADR 0032, Consequences). The order is the API's.
export function filterItems(
  items: readonly CatalogItem[],
  { q, archived, missing, category }: CatalogFilters,
): CatalogItem[] {
  const needle = normalize(q);
  return items.filter(
    (item) =>
      (archived || !item.archived) &&
      (!missing || item.nutrition == null) &&
      (category === null || item.category === category) &&
      normalize(item.name).includes(needle),
  );
}
