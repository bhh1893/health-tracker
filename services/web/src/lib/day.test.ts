import { describe, expect, it } from "vitest";

import { isValidDay, resolveViewedDay, toDay } from "./day";

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
