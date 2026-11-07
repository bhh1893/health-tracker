import { describe, expect, it } from "vitest";

import {
  defaultOccurredAt,
  onDay,
  timeOfDay,
  toRfc3339,
  withClockTime,
} from "./occurred";

// Vitest runs in Pacific/Auckland: +13:00 in November, +12:00 in July.
describe("toRfc3339", () => {
  it("writes the local clock with its offset", () => {
    expect(toRfc3339(new Date("2026-11-02T05:00:09Z"))).toBe(
      "2026-11-02T18:00:09+13:00",
    );
    expect(toRfc3339(new Date("2026-07-02T05:00:00Z"))).toBe(
      "2026-07-02T17:00:00+12:00",
    );
  });
});

describe("onDay", () => {
  it("reads the time as local", () => {
    expect(toRfc3339(onDay("2026-11-02", "07:30"))).toBe(
      "2026-11-02T07:30:00+13:00",
    );
  });
});

describe("defaultOccurredAt", () => {
  const now = onDay("2026-11-07", "09:15", 20);

  it("is now on Today", () => {
    expect(defaultOccurredAt("2026-11-07", null, now)).toEqual(now);
  });

  it("is the current clock time on a past Day", () => {
    const at = defaultOccurredAt("2026-11-02", null, now);
    expect(toRfc3339(at)).toBe("2026-11-02T09:15:20+13:00");
  });

  it("follows a later previous Set, so a repeat stays below it", () => {
    const at = defaultOccurredAt(
      "2026-11-02",
      "2026-11-02T18:00:00+13:00",
      now,
    );
    expect(toRfc3339(at)).toBe("2026-11-02T18:00:01+13:00");
    expect(timeOfDay(at)).toBe("18:00");
  });

  it("ignores an earlier previous Set", () => {
    const at = defaultOccurredAt(
      "2026-11-02",
      "2026-11-02T06:00:00+13:00",
      now,
    );
    expect(toRfc3339(at)).toBe("2026-11-02T09:15:20+13:00");
  });
});

describe("withClockTime", () => {
  it("keeps the date and the Set's own zone, not the phone's", () => {
    expect(
      withClockTime("2026-11-02T18:00:09-05:00", "America/New_York", "07:30"),
    ).toBe("2026-11-02T07:30:00-05:00");
  });

  it("finds the new offset across a daylight saving change", () => {
    // New Zealand left daylight time at 03:00 on 2026-04-05.
    expect(
      withClockTime("2026-04-05T00:30:00+13:00", "Pacific/Auckland", "08:00"),
    ).toBe("2026-04-05T08:00:00+12:00");
  });

  it("writes UTC as a zero offset", () => {
    expect(withClockTime("2026-11-02T18:00:00Z", "UTC", "07:30")).toBe(
      "2026-11-02T07:30:00+00:00",
    );
  });
});
