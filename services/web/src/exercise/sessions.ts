import type { components } from "../api/schema";
import type { CatalogRef } from "../catalog/catalogs";

export type { CatalogRef };
export type ExerciseEntry = components["schemas"]["ExerciseEntry"];
export type ExerciseEntryPage = components["schemas"]["ExerciseEntryPage"];
export type ExerciseSession = components["schemas"]["ExerciseSession"];

export interface Session {
  exercise: CatalogRef;
  sets: ExerciseEntry[];
}

function byOccurrence(a: ExerciseEntry, b: ExerciseEntry) {
  const difference = Date.parse(a.occurred_at) - Date.parse(b.occurred_at);
  return difference !== 0 ? difference : a.id.localeCompare(b.id);
}

// A Session is derived, never stored (ADR 0008): one Day's Sets of one Exercise.
// Sorted here, the same way the API numbers Sets, so a Set's position is its number
// even for an optimistic Set the server has not numbered yet. Cards keep the order
// of their first Set, so logging a Set never moves a card under the user's thumb.
export function groupSessions(entries: ExerciseEntry[]) {
  const sessions = new Map<string, Session>();
  for (const entry of entries.toSorted(byOccurrence)) {
    const session = sessions.get(entry.exercise.id);
    if (session) {
      session.sets.push(entry);
    } else {
      sessions.set(entry.exercise.id, {
        exercise: entry.exercise,
        sets: [entry],
      });
    }
  }
  return [...sessions.values()];
}

// The Set rules every form shares: whole reps above zero, and a blank weight means
// bodyweight. Null when the text is not a valid Set.
export function parseSetFields(weight: string, reps: string) {
  const repsValue = Number(reps);
  const weightValue = weight === "" ? null : Number(weight);
  const repsAreValid = Number.isInteger(repsValue) && repsValue > 0;
  const weightIsValid = weightValue === null || weightValue > 0;
  return repsAreValid && weightIsValid
    ? { reps: repsValue, weight_lb: weightValue }
    : null;
}

export function formatSet({
  weight_lb,
  reps,
}: Pick<ExerciseEntry, "weight_lb" | "reps">) {
  return `${weight_lb === null ? "BW" : `${String(weight_lb)} lb`} × ${String(reps)}`;
}

interface SetLike {
  reps: number;
  weight_lb: number | null;
}

// The heaviest Set, then the most reps at that weight. Bodyweight counts as lighter
// than any weight, so an all-bodyweight Session's top Set is its most reps.
export function topSet<T extends SetLike>(sets: T[]) {
  return sets.reduce<T | undefined>((best, set) => {
    if (best === undefined) {
      return set;
    }
    const weight = set.weight_lb ?? -1;
    const bestWeight = best.weight_lb ?? -1;
    return weight > bestWeight ||
      (weight === bestWeight && set.reps > best.reps)
      ? set
      : best;
  }, undefined);
}

// Total pounds moved: weight × reps over the weighted Sets. Null when every Set is
// bodyweight, since 0 lb would read as "did nothing".
export function volume(sets: SetLike[]) {
  const weighted = sets.filter((set) => set.weight_lb !== null);
  if (weighted.length === 0) {
    return null;
  }
  return weighted.reduce(
    (sum, set) => sum + (set.weight_lb ?? 0) * set.reps,
    0,
  );
}
