import { useQuery } from "@tanstack/react-query";

import { api, unwrap } from "../api/client";
import { addDays } from "../lib/day";
import type { DayTotal } from "./totals";

// The widest range one GET /days takes: `to` at most this many Days after `from`
// (ADR 0023).
export const MAX_RANGE_DAYS = 366;

// Every write that can change a Day Total invalidates this key.
export const DAY_TOTALS_KEY = "day-totals";

function getDays(from: string, to: string) {
  return unwrap(api.GET("/api/v1/days", { params: { query: { from, to } } }));
}

// The newest Day with a Meal on or before `day`, or null if there is none.
async function newestMealDay(day: string) {
  const page = await unwrap(
    api.GET("/api/v1/meals", { params: { query: { to: day, limit: 1 } } }),
  );
  return page.items[0]?.day ?? null;
}

// Day Totals from `from` to `to`, newest first. A null `from` means all of history.
//
// The API caps one request at 366 Days, so a longer range is read a window at a
// time, walking back from `to`. With no `from` there is no known start: after each
// window, one small request asks for the newest Meal before it. That both ends the
// walk and skips any gap, so a year without a single Meal does not hide older Days.
export async function fetchDayTotals(from: string | null, to: string) {
  const totals: DayTotal[] = [];
  let end: string | null = to;
  while (end !== null && (from === null || end >= from)) {
    const windowStart = addDays(end, -MAX_RANGE_DAYS);
    const start = from !== null && from > windowStart ? from : windowStart;
    totals.push(...(await getDays(start, end)));
    const before = addDays(start, -1);
    end = from === null ? await newestMealDay(before) : before;
  }
  return totals;
}

export function useDayTotals(from: string | null, to: string, enabled = true) {
  return useQuery({
    queryKey: [DAY_TOTALS_KEY, from, to],
    queryFn: () => fetchDayTotals(from, to),
    enabled,
  });
}
