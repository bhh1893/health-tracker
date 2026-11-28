import { parseDay } from "../lib/day";

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "long" });

// A Recent Days row's title, "Monday (11/16/26)" (ADR 0033); DayRow adds the colon. History's own: Add's
// Day pager keeps formatDay. The digits come straight from the Day's text; only
// the weekday needs a calendar.
export function formatDayTitle(day: string) {
  const [year = "", month = "", dayOfMonth = ""] = day.split("-");
  return `${WEEKDAY.format(parseDay(day))} (${month}/${dayOfMonth}/${year.slice(-2)})`;
}
