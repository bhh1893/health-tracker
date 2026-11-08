import { addDays, isValidDay } from "../lib/day";

// The Search screen's question, kept in the URL like the viewed Day (ADR 0013), so
// "Open this Day" followed by Back returns to the same results.

export type What = "exercise" | "food" | "all";
export type RangeName = "today" | "yesterday" | "7d" | "30d" | "custom";
export type View = "days" | "sessions";

// The picked Exercise or Food. The name rides along so a reload can show it in the
// search box without a request.
export interface Picked {
  id: string;
  name: string;
}

export interface SearchQuery {
  what: What;
  // Null until a suggestion is picked, and always for "all".
  item: Picked | null;
  range: RangeName;
  // The Days the range covers, inclusive, already resolved against today.
  from: string;
  to: string;
  // "sessions" is Last N Sessions, only for a picked Exercise.
  view: View;
  last: number;
}

const WHATS: readonly What[] = ["exercise", "food", "all"];
const RANGES: readonly RangeName[] = [
  "today",
  "yesterday",
  "7d",
  "30d",
  "custom",
];
const DEFAULTS = { what: "all", range: "30d", view: "days", last: 5 } as const;
// The API's cap on `limit` for sessions (ADR 0006).
export const MAX_LAST = 200;

function oneOf<T extends string>(
  value: string | null,
  allowed: readonly T[],
  fallback: T,
) {
  return allowed.find((option) => option === value) ?? fallback;
}

export function presetRange(
  range: Exclude<RangeName, "custom">,
  today: string,
) {
  switch (range) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const yesterday = addDays(today, -1);
      return { from: yesterday, to: yesterday };
    }
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "30d":
      return { from: addDays(today, -29), to: today };
  }
}

function customRange(params: URLSearchParams, today: string) {
  const day = (name: string) => {
    const value = params.get(name);
    return value !== null && isValidDay(value) && value <= today ? value : null;
  };
  const from = day("from");
  const to = day("to");
  if (from === null || to === null) {
    return null;
  }
  // Days as YYYY-MM-DD compare as dates. A reversed range is read the way it was
  // surely meant, not refused.
  return from <= to ? { from, to } : { from: to, to: from };
}

function parseLast(value: string | null) {
  const last = Number(value);
  return Number.isInteger(last) && last >= 1 && last <= MAX_LAST
    ? last
    : DEFAULTS.last;
}

// Never throws: a hand-edited or stale URL falls back to defaults field by field.
export function parseSearch(
  params: URLSearchParams,
  today: string,
): SearchQuery {
  const what = oneOf(params.get("what"), WHATS, DEFAULTS.what);
  const id = params.get("id");
  const item =
    what !== "all" && id !== null
      ? { id, name: params.get("name") ?? "" }
      : null;

  let range = oneOf(params.get("range"), RANGES, DEFAULTS.range);
  const custom = range === "custom" ? customRange(params, today) : null;
  if (range === "custom" && custom === null) {
    range = DEFAULTS.range;
  }
  const days =
    range === "custom" && custom !== null
      ? custom
      : presetRange(range === "custom" ? DEFAULTS.range : range, today);

  const view =
    what === "exercise" && item !== null && params.get("view") === "sessions"
      ? "sessions"
      : "days";

  return {
    what,
    item,
    range,
    ...days,
    view,
    last: parseLast(params.get("last")),
  };
}

// Writes only what differs from the defaults, so the plain screen is just /search.
export function toSearchParams(query: SearchQuery) {
  const params = new URLSearchParams();
  if (query.what !== DEFAULTS.what) {
    params.set("what", query.what);
  }
  if (query.item !== null) {
    params.set("id", query.item.id);
    params.set("name", query.item.name);
  }
  if (query.range !== DEFAULTS.range) {
    params.set("range", query.range);
  }
  if (query.range === "custom") {
    params.set("from", query.from);
    params.set("to", query.to);
  }
  if (query.view !== DEFAULTS.view) {
    params.set("view", query.view);
  }
  if (query.last !== DEFAULTS.last) {
    params.set("last", String(query.last));
  }
  return params;
}
