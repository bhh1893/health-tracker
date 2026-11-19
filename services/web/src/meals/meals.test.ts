import { describe, expect, it } from "vitest";

import { aMeal, banana, cafe, oats } from "../test-handlers";
import {
  buildMeal,
  draftOf,
  emptyDraft,
  parseQuantity,
  rowFor,
  sortMeals,
  toPutMeal,
} from "./meals";

const DAY = "2026-11-02";
const id = "0190a000-0000-7000-8000-0000000000c9";
const defaultAt = new Date(2026, 10, 2, 8, 30, 15);
const other = {
  ...cafe,
  id: "0190a000-0000-7000-8000-000000000202",
  name: "Taco Stand",
};

describe("parseQuantity", () => {
  it.each(["", " ", "0", "-1", "1000001", "abc"])("refuses %j", (text) => {
    expect(parseQuantity(text)).toBeNull();
  });

  it.each([
    ["80", 80],
    ["0.5", 0.5],
    ["1000000", 1_000_000],
  ])("reads %j", (text, value) => {
    expect(parseQuantity(text)).toBe(value);
  });
});

describe("rowFor", () => {
  it("prefills what was eaten last time", () => {
    expect(rowFor("k", oats)).toMatchObject({ quantity: "80", unit: "g" });
  });

  it("falls back to blank grams for a Food never eaten", () => {
    expect(rowFor("k", banana)).toMatchObject({ quantity: "", unit: "g" });
  });
});

describe("buildMeal", () => {
  const withRows = {
    ...emptyDraft("foods"),
    rows: [
      rowFor("a", oats),
      { ...rowFor("b", banana), quantity: "1", unit: "count" as const },
    ],
  };

  it("builds a new Foods Meal at the default instant, seconds kept", () => {
    const meal = buildMeal({
      id,
      day: DAY,
      draft: withRows,
      saved: null,
      defaultAt,
    });

    expect(meal).toMatchObject({
      kind: "foods",
      label: null,
      food_entries: [
        { food: { id: oats.id }, quantity: 80, unit: "g" },
        { food: { id: banana.id }, quantity: 1, unit: "count" },
      ],
    });
    expect(meal?.occurred_at.slice(11, 19)).toBe("08:30:15");
  });

  it("is null without Foods, or with a quantity being typed", () => {
    const build = (draft: typeof withRows) =>
      buildMeal({ id, day: DAY, draft, saved: null, defaultAt });

    expect(build(emptyDraft("foods"))).toBeNull();
    expect(
      build({ ...withRows, rows: [{ ...rowFor("a", oats), quantity: "" }] }),
    ).toBeNull();
  });

  it("builds a Restaurant Meal and ignores any Foods typed before switching", () => {
    const meal = buildMeal({
      id,
      day: DAY,
      draft: { ...withRows, kind: "restaurant", restaurants: [cafe, other] },
      saved: null,
      defaultAt,
    });

    expect(meal).toMatchObject({
      kind: "restaurant",
      restaurants: [cafe, other],
    });
    expect(meal && "food_entries" in meal).toBe(false);
  });

  it("is null for a Restaurant Meal with no Restaurants", () => {
    expect(
      buildMeal({
        id,
        day: DAY,
        draft: emptyDraft("restaurant"),
        saved: null,
        defaultAt,
      }),
    ).toBeNull();
  });

  it("trims the label and stores a blank one as null", () => {
    const build = (label: string) =>
      buildMeal({
        id,
        day: DAY,
        draft: { ...withRows, label },
        saved: null,
        defaultAt,
      })?.label;

    expect(build("  Breakfast ")).toBe("Breakfast");
    expect(build("   ")).toBeNull();
  });

  it("keeps a saved Meal's instant and zone through an edit", () => {
    const saved = aMeal({ occurred_at: "2026-11-02T08:00:42+13:00" });

    const meal = buildMeal({
      id,
      day: DAY,
      draft: { ...draftOf(saved), label: "Brunch" },
      saved,
      defaultAt,
    });

    expect(meal?.occurred_at).toBe(saved.occurred_at);
    expect(meal?.occurred_tz).toBe(saved.occurred_tz);
  });
});

describe("toPutMeal", () => {
  it("sends Catalog ids, not the embedded refs", () => {
    expect(toPutMeal(aMeal({ label: "Breakfast" }))).toEqual({
      kind: "foods",
      label: "Breakfast",
      occurred_at: "2026-11-02T08:00:00+13:00",
      occurred_tz: "Pacific/Auckland",
      food_entries: [{ food_id: oats.id, quantity: 80, unit: "g" }],
    });
  });
});

describe("sortMeals", () => {
  it("orders by time, then id, as the API numbers them", () => {
    const late = aMeal({ id: "b", occurred_at: "2026-11-02T19:00:00+13:00" });
    const tieB = aMeal({ id: "b2", occurred_at: "2026-11-02T08:00:00+13:00" });
    const tieA = aMeal({ id: "a2", occurred_at: "2026-11-02T08:00:00+13:00" });

    expect(sortMeals([late, tieB, tieA]).map(({ id }) => id)).toEqual([
      "a2",
      "b2",
      "b",
    ]);
  });
});
