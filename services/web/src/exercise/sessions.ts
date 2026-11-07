import type { components } from "../api/schema";

export type CatalogRef = components["schemas"]["CatalogRef"];
export type ExerciseEntry = components["schemas"]["ExerciseEntry"];
export type ExerciseEntryPage = components["schemas"]["ExerciseEntryPage"];

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

export function formatSet({
  weight_lb,
  reps,
}: Pick<ExerciseEntry, "weight_lb" | "reps">) {
  return `${weight_lb === null ? "BW" : `${String(weight_lb)} lb`} × ${String(reps)}`;
}
