import { describe, expect, it } from "vitest";

import {
  parseHistory,
  rangeStart,
  toHistoryParams,
  type HistoryQuery,
} from "./historyQuery";

const parse = (search: string) => parseHistory(new URLSearchParams(search));

describe("History in the URL", () => {
  it("defaults to Meals over 30 days, with nothing picked and the Dashboard closed", () => {
    expect(parse("")).toEqual({
      tab: "meals",
      range: "30d",
      exercise: null,
      dash: false,
    });
  });

  it("opens Exercise for a link from before ADR 0033, with an Exercise and no tab", () => {
    expect(parse("id=e1&name=Bench+Press")).toMatchObject({
      tab: "exercise",
      exercise: { id: "e1", name: "Bench Press" },
    });
  });

  it("reads each choice", () => {
    expect(
      parse("tab=meals&range=1y&id=e1&name=Bench+Press&dash=open"),
    ).toEqual({
      tab: "meals",
      range: "1y",
      exercise: { id: "e1", name: "Bench Press" },
      dash: true,
    });
  });

  it("falls back field by field on a hand-edited URL", () => {
    expect(parse("tab=sleep&range=2w&id=e1&dash=yes")).toEqual({
      tab: "exercise",
      range: "30d",
      exercise: { id: "e1", name: "" },
      dash: false,
    });
  });

  it("writes only what the reader would not infer", () => {
    const plain: HistoryQuery = {
      tab: "meals",
      range: "30d",
      exercise: null,
      dash: false,
    };
    const bench = { id: "e1", name: "Bench Press" };
    expect(toHistoryParams(plain).toString()).toBe("");
    expect(toHistoryParams({ ...plain, tab: "exercise" }).toString()).toBe(
      "tab=exercise",
    );
    // A picked Exercise implies the Exercise tab, so only Meals is written.
    expect(
      toHistoryParams({
        ...plain,
        tab: "exercise",
        exercise: bench,
      }).toString(),
    ).toBe("id=e1&name=Bench+Press");
    expect(
      toHistoryParams({
        tab: "meals",
        range: "all",
        exercise: bench,
        dash: true,
      }).toString(),
    ).toBe("tab=meals&range=all&id=e1&name=Bench+Press&dash=open");
  });

  it.each([
    "",
    "tab=exercise",
    "range=90d&dash=open",
    "id=e1&name=Squat",
    "tab=meals&range=90d&id=e1&name=Squat",
  ])("round-trips %j", (search) => {
    const query = parse(search);
    expect(parse(toHistoryParams(query).toString())).toEqual(query);
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
