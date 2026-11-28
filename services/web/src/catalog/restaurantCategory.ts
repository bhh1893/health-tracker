import type { components } from "../api/schema";

// What a Restaurant is for, separate from a Meal's label (ADR 0041). It changes no
// number: a Restaurant Day counts the same whatever its Categories.
export type RestaurantCategory =
  components["schemas"]["Restaurant"]["category"];

// The API's default, and what a new Restaurant starts as.
export const DEFAULT_CATEGORY: RestaurantCategory = "ate_out";

// In the order every list of them is drawn: chips, the picker and a Day's badges.
// `label` heads a control; `name` sits inside a sentence or a badge, lower case like
// the "incomplete" badge beside it.
export const CATEGORIES = [
  { id: "ate_out", label: "Ate out", name: "ate out" },
  { id: "drinks", label: "Drinks", name: "drinks" },
  { id: "dessert", label: "Dessert", name: "dessert" },
] as const satisfies readonly {
  id: RestaurantCategory;
  label: string;
  name: string;
}[];

export function categoryName(category: RestaurantCategory) {
  return CATEGORIES.find(({ id }) => id === category)?.name ?? category;
}

// Reads a Category from a URL, where anything else means no Category.
export function parseCategory(value: string | null): RestaurantCategory | null {
  return CATEGORIES.find(({ id }) => id === value)?.id ?? null;
}

// The Categories some Restaurants have, each once, in CATEGORIES' order, so two
// Days with the same mix read the same whatever order the Restaurants came in.
export function categoriesOf(
  restaurants: readonly { category: RestaurantCategory }[],
): RestaurantCategory[] {
  const present = new Set(restaurants.map(({ category }) => category));
  return CATEGORIES.map(({ id }) => id).filter((id) => present.has(id));
}
