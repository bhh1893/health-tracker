import { parseDay } from "../lib/day";

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "long" });

// A Recent Days row's title, "11-16-26 [Monday]" (ADR 0033). History's own: Add's
// Day pager keeps formatDay. The digits come straight from the Day's text; only
// the weekday needs a calendar.
export function formatDayTitle(day: string) {
  const [year = "", month = "", dayOfMonth = ""] = day.split("-");
  return `${month}-${dayOfMonth}-${year.slice(-2)} [${WEEKDAY.format(parseDay(day))}]`;
}
