import { describe, expect, it } from "vitest";

import { aSet } from "../test-handlers";
import { afterSave, planWrites, rowIsValid, toRow } from "./editSession";

const row = (fields = {}) => ({ ...toRow(aSet()), ...fields });

describe("planWrites", () => {
  it("sends nothing for an untouched row", () => {
    expect(planWrites([row()])).toEqual([]);
  });

  it("compares values, not the text in the input", () => {
    expect(planWrites([row({ weight: "135.0" })])).toEqual([]);
  });

  it("keeps the saved occurred_at when only reps change", () => {
    const [write] = planWrites([row({ reps: "6" })]);

    expect(write?.after).toEqual(aSet({ reps: 6 }));
  });

  it("clears the weight to bodyweight", () => {
    const [write] = planWrites([row({ weight: "" })]);

    expect(write?.after?.weight_lb).toBeNull();
  });

  it("writes a new time in the Set's own zone, not the phone's", () => {
    const saved = aSet({
      occurred_at: "2026-11-02T18:00:00-05:00",
      occurred_tz: "America/New_York",
    });
    const [write] = planWrites([{ ...toRow(saved), time: "07:30" }]);

    expect(write?.after?.occurred_at).toBe("2026-11-02T07:30:00-05:00");
  });

  it("sends only a delete for a row both edited and removed", () => {
    const writes = planWrites([row({ reps: "6", removed: true })]);

    expect(writes).toEqual([{ before: aSet(), after: null }]);
  });
});

describe("rowIsValid", () => {
  it("refuses a blank time or bad reps", () => {
    expect(rowIsValid(row())).toBe(true);
    expect(rowIsValid(row({ time: "" }))).toBe(false);
    expect(rowIsValid(row({ reps: "1.5" }))).toBe(false);
  });

  it("ignores the inputs of a removed row", () => {
    expect(rowIsValid(row({ reps: "", removed: true }))).toBe(true);
  });
});

describe("afterSave", () => {
  const changed = { ...toRow(aSet({ id: "changed" })), reps: "6" };
  const refused = { ...toRow(aSet({ id: "refused" })), reps: "7" };
  const removed = { ...toRow(aSet({ id: "removed" })), removed: true };
  const untouched = toRow(aSet({ id: "untouched" }));
  const rows = [changed, refused, removed, untouched];

  it("leaves only the failed write for the next Save", () => {
    const left = afterSave(rows, planWrites(rows), new Set(["refused"]));

    expect(left.map(({ saved }) => saved.id)).toEqual([
      "changed",
      "refused",
      "untouched",
    ]);
    expect(left.map(({ failed }) => failed)).toEqual([false, true, false]);
    expect(planWrites(left).map(({ before }) => before.id)).toEqual([
      "refused",
    ]);
  });

  it("keeps a failed delete removed, so retry deletes it", () => {
    const left = afterSave(rows, planWrites(rows), new Set(["removed"]));

    expect(planWrites(left)).toEqual([{ before: removed.saved, after: null }]);
  });
});
