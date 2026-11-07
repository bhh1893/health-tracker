import { describe, expect, it } from "vitest";

import { aSet, bench } from "../test-handlers";
import { formatSet, groupSessions } from "./sessions";

const squat = { ...bench, id: "squat", name: "Squat" };

describe("groupSessions", () => {
  it("groups by Exercise and orders Sets oldest first", () => {
    const sessions = groupSessions([
      aSet({ id: "b", occurred_at: "2026-11-02T18:10:00+13:00" }),
      aSet({
        id: "s",
        exercise: squat,
        occurred_at: "2026-11-02T18:05:00+13:00",
      }),
      aSet({ id: "a", occurred_at: "2026-11-02T18:00:00+13:00" }),
    ]);

    expect(sessions.map(({ exercise }) => exercise.name)).toEqual([
      "Bench Press",
      "Squat",
    ]);
    expect(sessions[0]?.sets.map(({ id }) => id)).toEqual(["a", "b"]);
  });

  it("compares instants, not text, across offsets", () => {
    const sessions = groupSessions([
      aSet({ id: "later", occurred_at: "2026-11-02T06:00:00+01:00" }),
      aSet({ id: "earlier", occurred_at: "2026-11-02T10:00:00+13:00" }),
    ]);

    expect(sessions[0]?.sets.map(({ id }) => id)).toEqual(["earlier", "later"]);
  });

  it("breaks a tie on id, as the API does", () => {
    const sessions = groupSessions([aSet({ id: "b" }), aSet({ id: "a" })]);

    expect(sessions[0]?.sets.map(({ id }) => id)).toEqual(["a", "b"]);
  });
});

describe("formatSet", () => {
  it("shows weight and reps", () => {
    expect(formatSet({ weight_lb: 135, reps: 5 })).toBe("135 lb × 5");
  });

  it("shows bodyweight when there is no weight", () => {
    expect(formatSet({ weight_lb: null, reps: 12 })).toBe("BW × 12");
  });
});
