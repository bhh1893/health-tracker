import { describe, expect, it } from "vitest";

import { formatDayTitle } from "./dayTitle";

describe("formatDayTitle", () => {
  it("writes the weekday, then MM/DD/YY in parentheses", () => {
    expect(formatDayTitle("2026-11-16")).toBe("Monday (11/16/26)");
  });

  it("keeps leading zeros", () => {
    expect(formatDayTitle("2027-01-05")).toBe("Tuesday (01/05/27)");
  });

  it("takes the year and weekday from the Day itself across a year boundary", () => {
    expect(formatDayTitle("2026-12-31")).toBe("Thursday (12/31/26)");
    expect(formatDayTitle("2027-01-01")).toBe("Friday (01/01/27)");
  });
});
