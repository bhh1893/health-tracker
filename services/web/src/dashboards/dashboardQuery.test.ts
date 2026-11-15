import { describe, expect, it } from "vitest";

import {
  parseDashboard,
  rangeStart,
  toDashboardParams,
  type DashboardQuery,
} from "./dashboardQuery";

const parse = (search: string) => parseDashboard(new URLSearchParams(search));

describe("the dashboard in the URL", () => {
  it("defaults to the Exercise tab over 30 days, with nothing picked", () => {
    expect(parse("")).toEqual({
      tab: "exercise",
      range: "30d",
      exercise: null,
    });
  });

  it("reads each choice", () => {
    expect(parse("tab=meals&range=1y&id=e1&name=Bench+Press")).toEqual({
      tab: "meals",
      range: "1y",
      exercise: { id: "e1", name: "Bench Press" },
    });
  });

  it("falls back field by field on a hand-edited URL", () => {
    expect(parse("tab=sleep&range=2w&id=e1")).toEqual({
      tab: "exercise",
      range: "30d",
      exercise: { id: "e1", name: "" },
    });
  });

  it("writes only what differs from the defaults", () => {
    const plain: DashboardQuery = {
      tab: "exercise",
      range: "30d",
      exercise: null,
    };
    expect(toDashboardParams(plain).toString()).toBe("");
    expect(
      toDashboardParams({
        tab: "meals",
        range: "all",
        exercise: { id: "e1", name: "Bench Press" },
      }).toString(),
    ).toBe("tab=meals&range=all&id=e1&name=Bench+Press");
  });

  it("round-trips", () => {
    const query = parse("tab=meals&range=90d&id=e1&name=Squat");
    expect(parse(toDashboardParams(query).toString())).toEqual(query);
  });
});

describe("rangeStart", () => {
  it("counts today as one of the Days", () => {
    expect(rangeStart("30d", "2026-11-15")).toBe("2026-10-17");
    expect(rangeStart("60d", "2026-11-15")).toBe("2026-09-17");
    expect(rangeStart("90d", "2026-11-15")).toBe("2026-08-18");
    expect(rangeStart("1y", "2026-11-15")).toBe("2025-11-16");
  });

  it("has no start for all of history", () => {
    expect(rangeStart("all", "2026-11-15")).toBeNull();
  });
});
