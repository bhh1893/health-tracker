import { formatSet } from "../exercise/sessions";
import { addDays } from "../lib/day";
import type { DayTotal } from "../nutrition/totals";
import { topSet, volume, type ExerciseSession } from "../exercise/sessions";

// One Session as the Exercise charts plot it. The rules for "top Set" and "volume"
// live with the Sets (ADR 0013), imported, so every screen agrees on them.
export interface SessionPoint {
  day: string;
  sets: number;
  // The top Set, written out: "185 lb × 5".
  top: string;
  // Null when the top Set is bodyweight.
  topWeight: number | null;
  topReps: number;
  // Null when every Set is bodyweight.
  volume: number | null;
}

// Oldest first, the order a chart reads left to right. The API answers newest first.
export function sessionPoints(sessions: ExerciseSession[]): SessionPoint[] {
  return sessions
    .flatMap(({ day, sets }) => {
      const top = topSet(sets);
      return top === undefined
        ? []
        : [
            {
              day,
              sets: sets.length,
              top: formatSet(top),
              topWeight: top.weight_lb,
              topReps: top.reps,
              volume: volume(sets),
            },
          ];
    })
    .toSorted((a, b) => a.day.localeCompare(b.day));
}

// What the top Set chart measures. An Exercise never done with weight is tracked by
// reps; once any Session has weight, weight is the measure and bodyweight Sessions
// are left off that chart.
export function topMeasure(points: SessionPoint[]) {
  return points.some((point) => point.topWeight !== null) ? "weight" : "reps";
}

export interface ExerciseSummary {
  sessions: number;
  best: SessionPoint | null;
  // Last top Set minus first, in the chart's measure. Null with under two Sessions.
  change: number | null;
  measure: "weight" | "reps";
}

export function summarizeExercise(points: SessionPoint[]): ExerciseSummary {
  const measure = topMeasure(points);
  const value = (point: SessionPoint) =>
    measure === "weight" ? point.topWeight : point.topReps;
  const measured = points.filter((point) => value(point) !== null);
  const best = measured.reduce<SessionPoint | null>((found, point) => {
    if (found === null) {
      return point;
    }
    const [a, b] = [value(point) ?? 0, value(found) ?? 0];
    // On a tie the heavier Set wins by reps, then the earlier Day keeps the record.
    return a > b || (a === b && point.topReps > found.topReps) ? point : found;
  }, null);
  const first = measured.at(0);
  const last = measured.at(-1);
  return {
    sessions: points.length,
    best,
    change:
      measured.length < 2 || first === undefined || last === undefined
        ? null
        : (value(last) ?? 0) - (value(first) ?? 0),
    measure,
  };
}

export interface MealsSummary {
  days: number;
  restaurantDays: number;
  incompleteDays: number;
  // Over every logged Day, Restaurant Days at their flat value: that value is how a
  // Restaurant Day is meant to weigh on the trend (ADR 0023). Null with no Days.
  averageKcal: number | null;
}

export function summarizeMeals(totals: DayTotal[]): MealsSummary {
  const kcal = totals.reduce((sum, total) => sum + total.kcal, 0);
  return {
    days: totals.length,
    restaurantDays: totals.filter((total) => total.restaurant_day).length,
    incompleteDays: totals.filter((total) => total.incomplete).length,
    averageKcal: totals.length === 0 ? null : kcal / totals.length,
  };
}

// The Day an "all of history" chart starts on: its oldest point, or a week back
// when there is at most one, so a single point is not stretched across the axis.
export function historyStart(days: string[], today: string) {
  const oldest = days.toSorted().at(0);
  const weekAgo = addDays(today, -6);
  return oldest !== undefined && oldest < weekAgo ? oldest : weekAgo;
}
