import { addDays } from "../lib/day";
import type { Picked } from "../search/searchQuery";

// What the Dashboards screen shows, kept in the URL like Search's question
// (ADR 0013, ADR 0024): a reload or the Back button returns to the same chart.

export type Tab = "exercise" | "meals";
export type RangeName = "30d" | "60d" | "90d" | "1y" | "all";

export interface DashboardQuery {
  tab: Tab;
  range: RangeName;
  // The picked Exercise. Kept while the Meals tab is shown, so switching back
  // returns to the same chart.
  exercise: Picked | null;
}

export const RANGE_DAYS: Record<Exclude<RangeName, "all">, number> = {
  "30d": 30,
  "60d": 60,
  "90d": 90,
  "1y": 365,
};

const TABS: readonly Tab[] = ["exercise", "meals"];
const RANGES: readonly RangeName[] = ["30d", "60d", "90d", "1y", "all"];
const DEFAULTS = { tab: "exercise", range: "30d" } as const;

// The first Day of a range that ends today, both ends included: "30 days" is today
// and the 29 Days before it. Null for all of history, which has no fixed start.
export function rangeStart(range: RangeName, today: string) {
  return range === "all" ? null : addDays(today, 1 - RANGE_DAYS[range]);
}

// Never throws: a hand-edited or stale URL falls back to defaults field by field.
export function parseDashboard(params: URLSearchParams): DashboardQuery {
  const id = params.get("id");
  return {
    tab: TABS.find((tab) => tab === params.get("tab")) ?? DEFAULTS.tab,
    range:
      RANGES.find((range) => range === params.get("range")) ?? DEFAULTS.range,
    exercise: id === null ? null : { id, name: params.get("name") ?? "" },
  };
}

// Writes only what differs from the defaults, so the plain screen is /history.
export function toDashboardParams(query: DashboardQuery) {
  const params = new URLSearchParams();
  if (query.tab !== DEFAULTS.tab) {
    params.set("tab", query.tab);
  }
  if (query.range !== DEFAULTS.range) {
    params.set("range", query.range);
  }
  if (query.exercise !== null) {
    params.set("id", query.exercise.id);
    params.set("name", query.exercise.name);
  }
  return params;
}
