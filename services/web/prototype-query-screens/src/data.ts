// PROTOTYPE, throwaway (issue #32). Read-only seed data standing in for GET /exercise-entries and /meals (ADR 0006).
export type SetE = { id: string; exercise: string; reps: number; weight_lb: number | null; time: string; day: string };
export type Meal = {
  id: string;
  n: number; // Meal number within the Day, derived at read time
  label: string | null;
  time: string;
  day: string;
  foods: { name: string; qty: number; unit: "g" | "count" }[];
  restaurant: string | null;
};

const pad = (n: number) => String(n).padStart(2, "0");
const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const dayOffset = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return fmt(d);
};
export const TODAY = dayOffset(0);

// Deterministic pseudo-random so every reload shows the same history.
let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];

const PLAN: Record<number, [string, number][]> = {
  0: [["Bench press", 135], ["Overhead press", 85]],
  2: [["Back squat", 185], ["Barbell row", 115]],
  4: [["Deadlift", 225], ["Pull-up", 0]],
};
const FOODS: [string, number, "g" | "count"][] = [
  ["Oats", 80, "g"], ["Banana", 1, "count"], ["Egg", 3, "count"], ["Chicken breast", 200, "g"],
  ["White rice", 180, "g"], ["Broccoli", 120, "g"], ["Greek yogurt", 170, "g"], ["Peanut butter", 30, "g"],
];
const RESTAURANTS = ["Taqueria El Sol", "Pho 99", "Green Bowl Salads"];

export const sets: SetE[] = [];
export const meals: Meal[] = [];
for (let off = 29; off >= 0; off--) {
  const day = dayOffset(off);
  const plan = PLAN[(29 - off) % 6];
  if (plan) {
    let mins = 17 * 60;
    plan.forEach(([exercise, base], ei) => {
      const progress = Math.floor((29 - off) / 6) * 5;
      const n = 3 + Math.floor(rnd() * 2);
      for (let i = 0; i < n; i++) {
        sets.push({
          id: `${day}-${ei}-${i}`,
          exercise,
          day,
          weight_lb: base === 0 ? null : base + progress,
          reps: Math.max(3, 8 - i - (rnd() < 0.3 ? 1 : 0)),
          time: `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`,
        });
        mins += 3;
      }
      mins += 5;
    });
  }
  const count = 2 + Math.floor(rnd() * 2);
  for (let m = 0; m < count; m++) {
    const resto = m === 2 && rnd() < 0.6;
    meals.push({
      id: `${day}-m${m}`,
      n: m + 1,
      day,
      time: `${pad(8 + m * 5)}:${pad(Math.floor(rnd() * 5) * 10)}`,
      label: ["Breakfast", "Lunch", "Dinner"][m] ?? null,
      restaurant: resto ? pick(RESTAURANTS) : null,
      foods: resto
        ? []
        : [...new Set([pick(FOODS), pick(FOODS), pick(FOODS)])].map(([name, qty, unit]) => ({ name, qty, unit })),
    });
  }
}

export const EXERCISES = [...new Set(sets.map((s) => s.exercise))];
export const FOOD_NAMES = [...new Set(meals.flatMap((m) => m.foods.map((f) => f.name)))].sort();

export type Session = { exercise: string; day: string; sets: SetE[] };
export const sessionsOn = (day: string): Session[] => {
  const by = new Map<string, SetE[]>();
  sets.filter((s) => s.day === day).forEach((s) => by.set(s.exercise, [...(by.get(s.exercise) ?? []), s]));
  return [...by].map(([exercise, ss]) => ({ exercise, day, sets: ss }));
};
export const mealsOn = (day: string) => meals.filter((m) => m.day === day);
// GET /exercise-entries?exercise_id=&last_sessions=N (ADR 0006), newest first.
export const lastSessions = (exercise: string, n: number): Session[] => {
  const days = [...new Set(sets.filter((s) => s.exercise === exercise).map((s) => s.day))].sort().reverse().slice(0, n);
  return days.map((day) => ({ exercise, day, sets: sets.filter((s) => s.exercise === exercise && s.day === day) }));
};
export const daysBack = (n: number) => Array.from({ length: n }, (_, i) => dayOffset(i));
export const hasFood = (m: Meal, food: string) => m.foods.some((f) => f.name === food);

export const fmtSet = (s: SetE) => `${s.weight_lb === null ? "BW" : `${s.weight_lb} lb`} × ${s.reps}`;
export const fmtDay = (day: string) => {
  const d = new Date(day + "T12:00:00");
  const label = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return day === TODAY ? `Today · ${label}` : day === dayOffset(1) ? `Yesterday · ${label}` : label;
};
export const shiftDay = (day: string, by: number) => {
  const d = new Date(day + "T12:00:00");
  d.setDate(d.getDate() + by);
  return fmt(d);
};

// pg_trgm-style similarity (same idea as ADR 0006's server-side typeahead): pad words, 3-char chunks, Jaccard overlap.
const trigrams = (s: string) => {
  const out = new Set<string>();
  for (const w of s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
    const p = `  ${w} `;
    for (let i = 0; i < p.length - 2; i++) out.add(p.slice(i, i + 3));
  }
  return out;
};
const similarity = (a: string, b: string) => {
  const A = trigrams(a);
  const B = trigrams(b);
  let inter = 0;
  A.forEach((t) => B.has(t) && inter++);
  return inter / (A.size + B.size - inter || 1);
};
// GET /{kind}s?q= : empty q = recently used first; else prefix hits then typo-tolerant matches. No "create" row when searching.
export function suggest(names: string[], q: string, limit = 6): string[] {
  const query = q.trim().toLowerCase();
  if (!query) return names.slice(0, limit);
  return names
    .map((n) => {
      const l = n.toLowerCase();
      const prefix = l.startsWith(query) || l.split(" ").some((w) => w.startsWith(query));
      return { n, score: (prefix ? 1 : 0) + similarity(query, l) };
    })
    .filter((x) => x.score >= 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.n);
}
