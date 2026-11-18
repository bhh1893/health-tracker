import { addDays } from "../lib/day";

// What the History screen shows, all of it in the URL (ADR 0033): a reload, the
// Back button and the bar's tab memory (ADR 0031) all return to the same view.

export type Tab = "exercise" | "meals";

// The picked Exercise. The name rides along so a reload can show it without a
// request.
export interface Picked {
  id: string;
  name: string;
}
export type RangeName = "30d" | "60d" | "90d" | "1y" | "all";

export interface HistoryQuery {
  tab: Tab;
  range: RangeName;
  // The picked Exercise. Kept while the Meals tab is shown, so switching back
  // returns to the same chart.
  exercise: Picked | null;
  // The Meals filter (`q`), already trimmed. Empty when there is none. Kept while
  // the Exercise tab is shown, like the Exercise pick on Meals.
  q: string;
  // Whether the Dashboard section is open (`dash=open`).
  dash: boolean;
}

export const RANGE_DAYS: Record<Exclude<RangeName, "all">, number> = {
  "30d": 30,
  "60d": 60,
  "90d": 90,
  "1y": 365,
};

const TABS: readonly Tab[] = ["exercise", "meals"];
const RANGES: readonly RangeName[] = ["30d", "60d", "90d", "1y", "all"];
const DEFAULT_RANGE = "30d";

// The tab a URL with no valid `tab` opens. Meals, except that a picked Exercise
// means Exercise: before ADR 0033 the default was Exercise and its URLs never
// wrote `tab`, so a saved Exercise chart still opens on its chart.
function impliedTab(exercise: Picked | null): Tab {
  return exercise === null ? "meals" : "exercise";
}

// The first Day of a range that ends today, both ends included: "30 days" is today
// and the 29 Days before it. Null for all of history, which has no fixed start.
export function rangeStart(range: RangeName, today: string) {
  return range === "all" ? null : addDays(today, 1 - RANGE_DAYS[range]);
}

// Never throws: a hand-edited or stale URL falls back to defaults field by field.
export function parseHistory(params: URLSearchParams): HistoryQuery {
  const id = params.get("id");
  const exercise = id === null ? null : { id, name: params.get("name") ?? "" };
  return {
    tab: TABS.find((tab) => tab === params.get("tab")) ?? impliedTab(exercise),
    range:
      RANGES.find((range) => range === params.get("range")) ?? DEFAULT_RANGE,
    exercise,
    q: params.get("q")?.trim() ?? "",
    dash: params.get("dash") === "open",
  };
}

// Writes only what the reader would not infer, so the plain screen is /history.
// `tab` is written when it differs from the implied one: Meals with an Exercise
// still picked needs `tab=meals`, or the reader would open Exercise.
export function toHistoryParams(query: HistoryQuery) {
  const params = new URLSearchParams();
  if (query.tab !== impliedTab(query.exercise)) {
    params.set("tab", query.tab);
  }
  if (query.range !== DEFAULT_RANGE) {
    params.set("range", query.range);
  }
  if (query.exercise !== null) {
    params.set("id", query.exercise.id);
    params.set("name", query.exercise.name);
  }
  if (query.q !== "") {
    params.set("q", query.q);
  }
  if (query.dash) {
    params.set("dash", "open");
  }
  return params;
}

// What an old Search URL (`/history/search`, `/search`) means on History (ADR
// 0033). A picked Food becomes the Meals filter by its name; a picked Exercise
// stays picked. Everything else, Search's ranges included, has no match here and
// falls to the defaults.
export function fromOldSearch(params: URLSearchParams): HistoryQuery {
  const query = parseHistory(new URLSearchParams());
  const what = params.get("what");
  const id = params.get("id");
  const name = params.get("name")?.trim() ?? "";
  if (id === null || name === "") {
    return query;
  }
  if (what === "food") {
    return { ...query, tab: "meals", q: name };
  }
  if (what === "exercise") {
    return { ...query, tab: "exercise", exercise: { id, name } };
  }
  return query;
}
