import { describe, expect, it } from "vitest";

import { formatDayTitle } from "./dayTitle";

describe("formatDayTitle", () => {
  it("writes MM-DD-YY and the weekday in square brackets", () => {
    expect(formatDayTitle("2026-11-16")).toBe("11-16-26 [Monday]");
  });

  it("keeps leading zeros", () => {
    expect(formatDayTitle("2027-01-05")).toBe("01-05-27 [Tuesday]");
  });

  it("takes the year and weekday from the Day itself across a year boundary", () => {
    expect(formatDayTitle("2026-12-31")).toBe("12-31-26 [Thursday]");
    expect(formatDayTitle("2027-01-01")).toBe("01-01-27 [Friday]");
  });
});
