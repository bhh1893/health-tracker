import type { components } from "../api/schema";
import {
  formatSet,
  groupSessions,
  type ExerciseEntry,
  type Session,
} from "../exercise/sessions";
import { sortMeals, type Meal } from "../meals/meals";

export type ExerciseSession = components["schemas"]["ExerciseSession"];

// What one cursor stream has loaded so far, newest Day first (ADR 0006's keyset
// order). Null means the query does not read this collection at all.
export interface Stream<T> {
  items: T[];
  done: boolean;
}

export interface DayResult {
  day: string;
  sessions: Session[];
  meals: Meal[];
}

// Greater than any YYYY-MM-DD, so "day > NOTHING_READ" is never true.
const NOTHING_READ = "~";

// The Day a stream has read down to, or null once it is finished. The next page
// starts at this Day or older, so only Days strictly newer are known to be whole.
function frontier<T extends { day: string }>(stream: Stream<T> | null) {
  if (stream === null || stream.done) {
    return null;
  }
  // Before the first page, nothing is known, so no Day is whole yet.
  return stream.items.at(-1)?.day ?? NOTHING_READ;
}

// The Days that are whole in every stream: each unfinished stream has already read
// past them. Showing a Day before that would show it half filled, then change it
// under the user's thumb when the next page lands. Newest Day first.
export function wholeDays(
  entries: Stream<ExerciseEntry> | null,
  meals: Stream<Meal> | null,
): DayResult[] {
  const limits = [frontier(entries), frontier(meals)].filter(
    (limit) => limit !== null,
  );
  const isWhole = (day: string) => limits.every((limit) => day > limit);

  const byDay = new Map<string, { entries: ExerciseEntry[]; meals: Meal[] }>();
  const slot = (day: string) => {
    let found = byDay.get(day);
    if (found === undefined) {
      found = { entries: [], meals: [] };
      byDay.set(day, found);
    }
    return found;
  };
  for (const entry of entries?.items ?? []) {
    if (isWhole(entry.day)) {
      slot(entry.day).entries.push(entry);
    }
  }
  for (const meal of meals?.items ?? []) {
    if (isWhole(meal.day)) {
      slot(meal.day).meals.push(meal);
    }
  }

  return [...byDay.entries()]
    .toSorted(([a], [b]) => b.localeCompare(a))
    .map(([day, found]) => ({
      day,
      sessions: groupSessions(found.entries),
      meals: sortMeals(found.meals),
    }));
}

// Which stream to read next: the unfinished one that has read the least far back,
// because it is the one holding Days back from being whole. Null when both are done.
export function laggingStream(
  entries: Stream<ExerciseEntry> | null,
  meals: Stream<Meal> | null,
): "entries" | "meals" | null {
  const entriesAt = frontier(entries);
  const mealsAt = frontier(meals);
  if (entriesAt === null) {
    return mealsAt === null ? null : "meals";
  }
  if (mealsAt === null) {
    return "entries";
  }
  return entriesAt >= mealsAt ? "entries" : "meals";
}

const count = (n: number, noun: string) =>
  `${String(n)} ${noun}${n === 1 ? "" : "s"}`;

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

// The one line on a collapsed Day row (ADR 0013).
export function summarize({ sessions, meals }: DayResult) {
  const sets = sessions.flatMap((session) => session.sets);
  const top = topSet(sets);
  const parts: string[] = [];
  if (sessions.length > 1) {
    parts.push(count(sessions.length, "exercise"));
  }
  if (sets.length > 0) {
    parts.push(count(sets.length, "set"));
  }
  if (sessions.length === 1 && top !== undefined) {
    parts.push(`top ${formatSet(top)}`);
  }
  if (meals.length > 0) {
    parts.push(count(meals.length, "meal"));
  }
  return parts.join(", ");
}

export interface SessionStats {
  day: string;
  sets: number;
  top: string;
  volume: number | null;
}

// One row of the Last N Sessions table.
export function sessionStats({ day, sets }: ExerciseSession): SessionStats {
  const top = topSet(sets);
  return {
    day,
    sets: sets.length,
    top: top === undefined ? "" : formatSet(top),
    volume: volume(sets),
  };
}
