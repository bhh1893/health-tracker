import { describe, expect, it } from "vitest";

import { parseSearch, toSearchParams } from "./searchQuery";

const TODAY = "2026-11-08";
const parse = (search: string) =>
  parseSearch(new URLSearchParams(search), TODAY);

describe("parseSearch", () => {
  it("defaults to Everything over the last 30 days", () => {
    expect(parse("")).toEqual({
      what: "all",
      item: null,
      range: "30d",
      from: "2026-10-10",
      to: TODAY,
      view: "days",
      last: 5,
    });
  });

  it("resolves each preset against today", () => {
    expect(parse("range=today")).toMatchObject({ from: TODAY, to: TODAY });
    expect(parse("range=yesterday")).toMatchObject({
      from: "2026-11-07",
      to: "2026-11-07",
    });
    expect(parse("range=7d")).toMatchObject({ from: "2026-11-02", to: TODAY });
  });

  it("reads a picked Food with its name", () => {
    expect(parse("what=food&id=f1&name=Oats").item).toEqual({
      id: "f1",
      name: "Oats",
    });
  });

  it("ignores a pick for Everything", () => {
    expect(parse("id=f1&name=Oats").item).toBeNull();
  });

  it("reads a custom range and puts a reversed one in order", () => {
    expect(parse("range=custom&from=2026-11-05&to=2026-11-01")).toMatchObject({
      range: "custom",
      from: "2026-11-01",
      to: "2026-11-05",
    });
  });

  it.each([
    "range=custom",
    "range=custom&from=2026-11-01&to=2026-12-01",
    "range=custom&from=2026-02-31&to=2026-11-01",
  ])("falls back to 30 days for a broken custom range: %s", (search) => {
    expect(parse(search)).toMatchObject({ range: "30d", from: "2026-10-10" });
  });

  it("allows Last Sessions only for a picked Exercise", () => {
    expect(parse("what=exercise&id=e1&name=Bench&view=sessions").view).toBe(
      "sessions",
    );
    expect(parse("what=exercise&view=sessions").view).toBe("days");
    expect(parse("what=food&id=f1&view=sessions").view).toBe("days");
  });

  it.each(["0", "201", "2.5", "x"])("refuses last=%s", (last) => {
    expect(parse(`last=${last}`).last).toBe(5);
  });

  it("falls back on unknown values", () => {
    expect(parse("what=sleep&range=forever")).toMatchObject({
      what: "all",
      range: "30d",
    });
  });
});

describe("toSearchParams", () => {
  it("writes nothing for the defaults", () => {
    expect(toSearchParams(parse("")).toString()).toBe("");
  });

  it("round-trips a full question", () => {
    const search =
      "what=exercise&id=e1&name=Bench+Press&range=custom&from=2026-11-01&to=2026-11-05&view=sessions&last=8";
    expect(toSearchParams(parse(search)).toString()).toBe(search);
  });

  it("leaves out from and to for a preset, so it stays relative to today", () => {
    expect(toSearchParams(parse("range=7d")).toString()).toBe("range=7d");
  });
});
