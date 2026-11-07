import { describe, expect, it } from "vitest";

import { addDays, formatDay, isValidDay, resolveViewedDay, toDay } from "./day";

describe("toDay", () => {
  it("uses the device's local date, not UTC", () => {
    // Local midnight and the last local second are the same Day in every timezone;
    // a UTC-based version fails one of these under the TZ set in vite.config.ts.
    expect(toDay(new Date(2026, 10, 3, 0, 0, 0))).toBe("2026-11-03");
    expect(toDay(new Date(2026, 10, 3, 23, 59, 59))).toBe("2026-11-03");
  });
});

describe("isValidDay", () => {
  it("accepts real dates, including a leap day", () => {
    expect(isValidDay("2026-11-03")).toBe(true);
    expect(isValidDay("2028-02-29")).toBe(true);
  });

  it.each(["2026-02-31", "2026-13-01", "2026-1-1", "today", ""])(
    "rejects %j",
    (value) => {
      expect(isValidDay(value)).toBe(false);
    },
  );
});

describe("resolveViewedDay", () => {
  const today = "2026-11-06";

  it("defaults to today", () => {
    expect(resolveViewedDay(null, today)).toBe(today);
  });

  it("keeps a past Day", () => {
    expect(resolveViewedDay("2026-11-02", today)).toBe("2026-11-02");
  });

  it("falls back to today for a future or malformed Day", () => {
    expect(resolveViewedDay("2026-11-07", today)).toBe(today);
    expect(resolveViewedDay("garbage", today)).toBe(today);
  });
});

describe("addDays", () => {
  it("crosses month and year ends", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  // New Zealand's clocks change on these dates, so these Days are 25 and 23 hours.
  it("steps exactly one Day across daylight saving changes", () => {
    expect(addDays("2026-04-05", 1)).toBe("2026-04-06");
    expect(addDays("2026-09-27", 1)).toBe("2026-09-28");
    expect(addDays("2026-09-28", -1)).toBe("2026-09-27");
  });
});

describe("formatDay", () => {
  it("writes the short form with no comma", () => {
    expect(formatDay("2026-11-02")).toBe("Mon Nov 2");
  });
});
