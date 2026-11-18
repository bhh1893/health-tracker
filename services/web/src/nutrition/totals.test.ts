import { describe, expect, it } from "vitest";

import { formatKcal, formatMacros, type DayTotal } from "./totals";

const total = (fields: Partial<DayTotal> = {}): DayTotal => ({
  day: "2026-11-02",
  kcal: 2130.4,
  protein_g: 150.2,
  carbs_g: 200,
  fat_g: 70.6,
  restaurant_day: false,
  incomplete: false,
  ...fields,
});

describe("formatting totals", () => {
  it("rounds calories to whole numbers with thousands separators", () => {
    expect(formatKcal(2130.4)).toBe("2,130 kcal");
    expect(formatKcal(0)).toBe("0 kcal");
  });

  it("writes macros in a fixed order", () => {
    expect(formatMacros(total())).toBe("P 150 g · C 200 g · F 71 g");
  });

  it("has no macros to write for a Restaurant Day, rather than zeros", () => {
    const unknown = { protein_g: null, carbs_g: null, fat_g: null };
    expect(formatMacros(total(unknown))).toBeNull();
  });
});
