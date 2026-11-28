import { describe, expect, it } from "vitest";

import {
  filterItems,
  parseFilters,
  toSearchParams,
  type CatalogFilters,
} from "./catalogFilters";
import type { CatalogItem } from "./catalogs";

const nutrition = {
  basis_g: 100,
  kcal: 165,
  protein_g: 31,
  carbs_g: 0,
  fat_g: 3.6,
};

const item = (
  name: string,
  fields: Partial<CatalogItem> = {},
): CatalogItem => ({
  id: name,
  name,
  archived: false,
  ...fields,
});

const restaurants = [
  item("Golden diner", { category: "ate_out" }),
  item("Corner bar", { category: "drinks" }),
  item("Gelato stand", { category: "dessert" }),
  item("Old pub", { category: "drinks", archived: true }),
];

const chicken = item("Chicken breast", { nutrition });
const chickenSoup = item("Chicken soup", { nutrition: null });
const oldChicken = item("Chicken thigh", { archived: true, nutrition: null });
const rice = item("Rice", { nutrition: null });
const ITEMS = [chicken, chickenSoup, oldChicken, rice];

const none: CatalogFilters = {
  q: "",
  archived: false,
  missing: false,
  category: null,
};
const foods = { nutrition: true, category: false };
const onRestaurants = { nutrition: false, category: true };
const names = (filters: Partial<CatalogFilters>) =>
  filterItems(ITEMS, { ...none, ...filters }).map(({ name }) => name);

describe("filterItems", () => {
  it("keeps every active item, in the API's order, with no filter", () => {
    expect(names({})).toEqual(["Chicken breast", "Chicken soup", "Rice"]);
  });

  it("matches anywhere in the name, ignoring case and extra spaces", () => {
    expect(names({ q: "SOUP" })).toEqual(["Chicken soup"]);
    expect(names({ q: "  chicken   BREAST " })).toEqual(["Chicken breast"]);
  });

  it("is a substring match, not a fuzzy one", () => {
    expect(names({ q: "chiken" })).toEqual([]);
  });

  it("combines all three filters", () => {
    expect(names({ q: "chicken", missing: true })).toEqual(["Chicken soup"]);
    expect(names({ q: "chicken", missing: true, archived: true })).toEqual([
      "Chicken soup",
      "Chicken thigh",
    ]);
  });

  it("keeps only Restaurants of the chosen Category, with the other filters", () => {
    const of = (filters: Partial<CatalogFilters>) =>
      filterItems(restaurants, { ...none, ...filters }).map(({ name }) => name);

    expect(of({ category: "drinks" })).toEqual(["Corner bar"]);
    expect(of({ category: "drinks", archived: true })).toEqual([
      "Corner bar",
      "Old pub",
    ]);
    expect(of({ category: "dessert", q: "bar" })).toEqual([]);
  });
});

describe("the URL", () => {
  it("round-trips every filter", () => {
    const filters = {
      q: "chicken soup",
      archived: true,
      missing: true,
      category: "drinks" as const,
    };

    const params = toSearchParams(filters);

    expect(params.toString()).toBe(
      "q=chicken+soup&archived=1&missing=1&category=drinks",
    );
    expect(parseFilters(params, { nutrition: true, category: true })).toEqual(
      filters,
    );
  });

  it("leaves defaults out, so an unfiltered page has a bare URL", () => {
    expect(toSearchParams(none).toString()).toBe("");
    expect(parseFilters(new URLSearchParams(), foods)).toEqual(none);
  });

  it("ignores ?missing=1 on a Catalog without Nutrition", () => {
    const params = new URLSearchParams("missing=1");

    expect(parseFilters(params, onRestaurants).missing).toBe(false);
  });

  it("ignores ?category= on a Catalog without Categories", () => {
    const params = new URLSearchParams("category=drinks");

    expect(parseFilters(params, foods).category).toBeNull();
  });

  it("ignores a Category that does not exist", () => {
    const params = new URLSearchParams("category=brunch");

    expect(parseFilters(params, onRestaurants).category).toBeNull();
  });
});
