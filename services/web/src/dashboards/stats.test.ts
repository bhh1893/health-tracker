import { describe, expect, it } from "vitest";

import type { DayTotal } from "../nutrition/totals";
import type { ExerciseSession } from "../exercise/sessions";
import {
  historyStart,
  sessionPoints,
  summarizeExercise,
  summarizeMeals,
  topMeasure,
} from "./stats";

const session = (
  day: string,
  ...sets: [reps: number, weight: number | null][]
): ExerciseSession => ({
  day,
  sets: sets.map(([reps, weight_lb], index) => ({
    number: index + 1,
    reps,
    weight_lb,
  })),
});

describe("sessionPoints", () => {
  it("turns newest-first Sessions into oldest-first points", () => {
    const points = sessionPoints([
      session("2026-11-03", [5, 140], [3, 150]),
      session("2026-11-01", [5, 135]),
    ]);

    expect(points).toEqual([
      {
        day: "2026-11-01",
        sets: 1,
        top: "135 lb × 5",
        topWeight: 135,
        topReps: 5,
        volume: 675,
      },
      {
        day: "2026-11-03",
        sets: 2,
        top: "150 lb × 3",
        topWeight: 150,
        topReps: 3,
        volume: 1150,
      },
    ]);
  });

  it("has no weight or volume for a bodyweight Session", () => {
    const [point] = sessionPoints([
      session("2026-11-01", [8, null], [10, null]),
    ]);

    expect(point).toMatchObject({
      top: "BW × 10",
      topWeight: null,
      topReps: 10,
      volume: null,
    });
  });
});

describe("summarizeExercise", () => {
  it("measures by weight once any Session has weight", () => {
    const points = sessionPoints([
      session("2026-11-05", [5, 150]),
      session("2026-11-03", [12, null]),
      session("2026-11-01", [5, 135]),
    ]);

    expect(topMeasure(points)).toBe("weight");
    expect(summarizeExercise(points)).toMatchObject({
      sessions: 3,
      change: 15,
      measure: "weight",
      best: { day: "2026-11-05", top: "150 lb × 5" },
    });
  });

  it("measures an Exercise never done with weight by reps", () => {
    const points = sessionPoints([
      session("2026-11-03", [9, null]),
      session("2026-11-01", [12, null]),
    ]);

    expect(summarizeExercise(points)).toMatchObject({
      measure: "reps",
      change: -3,
      best: { day: "2026-11-01" },
    });
  });

  it("breaks a tie on weight by reps, then keeps the earlier Day", () => {
    const points = sessionPoints([
      session("2026-11-05", [6, 150]),
      session("2026-11-03", [6, 150]),
      session("2026-11-01", [5, 150]),
    ]);

    expect(summarizeExercise(points).best?.day).toBe("2026-11-03");
  });

  it("has no change to report from a single Session", () => {
    const summary = summarizeExercise(
      sessionPoints([session("2026-11-01", [5, 135])]),
    );

    expect(summary.change).toBeNull();
    expect(summary.best?.top).toBe("135 lb × 5");
  });
});

describe("summarizeMeals", () => {
  const total = (fields: Partial<DayTotal>): DayTotal => ({
    day: "2026-11-01",
    kcal: 2000,
    protein_g: 100,
    carbs_g: 200,
    fat_g: 50,
    restaurant_day: false,
    incomplete: false,
    ...fields,
  });

  it("averages over every logged Day, Restaurant Days at their flat value", () => {
    const summary = summarizeMeals([
      total({ kcal: 2000 }),
      total({ kcal: 1000, incomplete: true }),
      total({ kcal: 5000, restaurant_day: true }),
      total({ kcal: 2000 }),
    ]);

    expect(summary).toEqual({
      days: 4,
      restaurantDays: 1,
      incompleteDays: 1,
      averageKcal: 2500,
    });
  });

  it("has no average with nothing logged", () => {
    expect(summarizeMeals([]).averageKcal).toBeNull();
  });
});

describe("historyStart", () => {
  it("starts all of history at its oldest Day", () => {
    expect(historyStart(["2026-03-01", "2025-06-10"], "2026-11-15")).toBe(
      "2025-06-10",
    );
  });

  it("shows at least a week, so one recent point is not stretched wide", () => {
    expect(historyStart(["2026-11-14"], "2026-11-15")).toBe("2026-11-09");
    expect(historyStart([], "2026-11-15")).toBe("2026-11-09");
  });
});
