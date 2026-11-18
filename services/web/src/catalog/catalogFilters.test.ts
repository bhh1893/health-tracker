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

const chicken = item("Chicken breast", { nutrition });
const chickenSoup = item("Chicken soup", { nutrition: null });
const oldChicken = item("Chicken thigh", { archived: true, nutrition: null });
const rice = item("Rice", { nutrition: null });
const ITEMS = [chicken, chickenSoup, oldChicken, rice];

const none: CatalogFilters = { q: "", archived: false, missing: false };
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
});

describe("the URL", () => {
  it("round-trips every filter", () => {
    const filters = { q: "chicken soup", archived: true, missing: true };

    const params = toSearchParams(filters);

    expect(params.toString()).toBe("q=chicken+soup&archived=1&missing=1");
    expect(parseFilters(params, true)).toEqual(filters);
  });

  it("leaves defaults out, so an unfiltered page has a bare URL", () => {
    expect(toSearchParams(none).toString()).toBe("");
    expect(parseFilters(new URLSearchParams(), true)).toEqual(none);
  });

  it("ignores ?missing=1 on a Catalog without Nutrition", () => {
    const params = new URLSearchParams("missing=1");

    expect(parseFilters(params, false).missing).toBe(false);
  });
});
