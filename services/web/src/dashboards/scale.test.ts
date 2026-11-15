import { describe, expect, it } from "vitest";

import { niceTicks } from "./scale";

describe("niceTicks", () => {
  it("covers the values with round steps, not the values' own odd spacing", () => {
    expect(niceTicks([155, 185], false)).toEqual([150, 160, 170, 180, 190]);
  });

  it("starts an amount at zero", () => {
    expect(niceTicks([1900, 2600, 5000], true)).toEqual([0, 2000, 4000, 6000]);
  });

  it("does not start a measure read by its change at zero", () => {
    expect(niceTicks([2300, 2800], false)).toEqual([2200, 2400, 2600, 2800]);
  });

  it("opens room under a single value", () => {
    expect(niceTicks([135], false)).toEqual([120, 125, 130, 135]);
    expect(niceTicks([0], true)).toEqual([-1, -0.75, -0.5, -0.25, 0]);
  });

  it("keeps fractional steps exact", () => {
    expect(niceTicks([0.1, 0.5], false)).toEqual([0.1, 0.2, 0.3, 0.4, 0.5]);
  });

  it("has an axis even with nothing to plot", () => {
    expect(niceTicks([], true)).toEqual([0, 1]);
  });
});
