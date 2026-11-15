import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { addDays } from "../lib/day";
import { aMeal } from "../test-handlers";
import { server } from "../test-server";
import { fetchDayTotals, MAX_RANGE_DAYS } from "./queries";
import type { DayTotal } from "./totals";

const aTotal = (day: string): DayTotal => ({
  day,
  kcal: 2000,
  protein_g: 100,
  carbs_g: 200,
  fat_g: 50,
  restaurant_day: false,
  incomplete: false,
});

// A stand-in for GET /days and GET /meals that holds the API's rules: a range wider
// than 366 Days is refused, and both answer newest first.
function fakeDays(days: string[]) {
  const windows: [string, string][] = [];
  const lookups: string[] = [];
  server.use(
    http.get("*/api/v1/days", ({ request }) => {
      const query = new URL(request.url).searchParams;
      const from = query.get("from") ?? "";
      const to = query.get("to") ?? "";
      windows.push([from, to]);
      if (addDays(from, MAX_RANGE_DAYS) < to || to < from) {
        return HttpResponse.json(
          { title: "Unprocessable Content", status: 422 },
          { status: 422 },
        );
      }
      const found = days.filter((day) => day >= from && day <= to);
      return HttpResponse.json(found.toSorted().toReversed().map(aTotal));
    }),
    http.get("*/api/v1/meals", ({ request }) => {
      const to = new URL(request.url).searchParams.get("to") ?? "";
      lookups.push(to);
      const newest = days
        .filter((day) => day <= to)
        .toSorted()
        .at(-1);
      return HttpResponse.json({
        items: newest === undefined ? [] : [aMeal({ day: newest })],
        next_cursor: null,
      });
    }),
  );
  return { windows, lookups };
}

const daysOf = (totals: DayTotal[]) => totals.map(({ day }) => day);

describe("fetchDayTotals", () => {
  it("reads a short range in one request", async () => {
    const api = fakeDays(["2026-11-01", "2026-11-10", "2026-10-01"]);

    const totals = await fetchDayTotals("2026-10-17", "2026-11-15");

    expect(daysOf(totals)).toEqual(["2026-11-10", "2026-11-01"]);
    expect(api.windows).toEqual([["2026-10-17", "2026-11-15"]]);
    expect(api.lookups).toEqual([]);
  });

  it("reads the widest range the API takes in one request", async () => {
    const api = fakeDays([]);

    await fetchDayTotals("2025-11-14", "2026-11-15");

    expect(api.windows).toEqual([["2025-11-14", "2026-11-15"]]);
  });

  it("splits a longer range into windows that touch but never overlap", async () => {
    const api = fakeDays([
      "2024-06-01",
      "2025-11-13",
      "2025-11-14",
      "2026-11-15",
    ]);

    const totals = await fetchDayTotals("2024-01-01", "2026-11-15");

    expect(api.windows).toEqual([
      ["2025-11-14", "2026-11-15"],
      ["2024-11-12", "2025-11-13"],
      ["2024-01-01", "2024-11-11"],
    ]);
    expect(daysOf(totals)).toEqual([
      "2026-11-15",
      "2025-11-14",
      "2025-11-13",
      "2024-06-01",
    ]);
  });

  it("reads all of history, jumping over a gap longer than a window", async () => {
    const api = fakeDays(["2020-03-01", "2020-02-27", "2026-11-01"]);

    const totals = await fetchDayTotals(null, "2026-11-15");

    expect(daysOf(totals)).toEqual(["2026-11-01", "2020-03-01", "2020-02-27"]);
    // The second window ends on the newest older Meal, not 366 Days further back.
    expect(api.windows).toEqual([
      ["2025-11-14", "2026-11-15"],
      ["2019-03-01", "2020-03-01"],
    ]);
    expect(api.lookups).toEqual(["2025-11-13", "2019-02-28"]);
  });

  it("stops at once when nothing was ever logged", async () => {
    const api = fakeDays([]);

    expect(await fetchDayTotals(null, "2026-11-15")).toEqual([]);
    expect(api.windows).toHaveLength(1);
  });
});
