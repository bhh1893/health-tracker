// PROTOTYPE, throwaway (issue #14). In-memory stand-in for the API (ADR 0006).
// Nothing persists: reload resets everything.

export type Kind = "food" | "exercise" | "restaurant";
export type Unit = "g" | "count";
export type Item = { id: string; name: string; archived?: boolean; last_unit?: Unit };

export type FoodEntry = { food: Item; quantity: number; unit: Unit };
export type MealDraft = {
  id: string;
  label: string;
  occurred_at: string; // datetime-local value
  food_entries: FoodEntry[];
  restaurant: Item | null;
};
export type SetDraft = {
  id: string;
  exercise: Item;
  reps: number;
  weight_lb: number | null; // null = bodyweight
  occurred_at: string;
};
export type Saved = { type: "meal"; meal: MealDraft } | { type: "set"; set: SetDraft };

// Fake UUIDv7: 48-bit ms timestamp, then random bits, so ids sort by creation time.
export function uuidv7(): string {
  const ts = Date.now().toString(16).padStart(12, "0");
  // getRandomValues, not randomUUID: randomUUID only exists in secure contexts (HTTPS or localhost),
  // and this prototype is opened over plain http://<LAN IP> from the phone.
  const rnd = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => b.toString(16).padStart(2, "0")).join("");
  const hex = ts + "7" + rnd.slice(1, 4) + "8" + rnd.slice(5, 20);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function nowLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

const mk = (name: string, extra: Partial<Item> = {}): Item => ({ id: uuidv7(), name, ...extra });

export const catalogs: Record<Kind, Item[]> = {
  food: [
    mk("Chicken breast", { last_unit: "g" }),
    mk("White rice", { last_unit: "g" }),
    mk("Egg", { last_unit: "count" }),
    mk("Banana", { last_unit: "count" }),
    mk("Greek yogurt", { last_unit: "g" }),
    mk("Oats", { last_unit: "g" }),
    mk("Broccoli", { last_unit: "g" }),
    mk("Peanut butter", { last_unit: "g" }),
    mk("Protein shake", { last_unit: "count", archived: true }),
  ],
  exercise: [
    mk("Bench press"),
    mk("Back squat"),
    mk("Deadlift"),
    mk("Overhead press"),
    mk("Pull-up"),
    mk("Barbell row"),
    mk("Dumbbell curl"),
  ],
  restaurant: [mk("Taqueria El Sol"), mk("Pho 99"), mk("Green Bowl Salads")],
};

// pg_trgm-style similarity: pad each word, take 3-char chunks, Jaccard overlap.
function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
    const p = `  ${w} `;
    for (let i = 0; i < p.length - 2; i++) out.add(p.slice(i, i + 3));
  }
  return out;
}
export function similarity(a: string, b: string): number {
  const A = trigrams(a);
  const B = trigrams(b);
  let inter = 0;
  A.forEach((t) => B.has(t) && inter++);
  return inter / (A.size + B.size - inter || 1);
}

// GET /{kind}s?q=&limit=10 : prefix matches first, then typo-tolerant matches.
export function suggest(kind: Kind, q: string, limit = 10): Item[] {
  const live = catalogs[kind].filter((i) => !i.archived);
  const query = q.trim().toLowerCase();
  if (!query) return live.slice(0, limit);
  return live
    .map((i) => {
      const n = i.name.toLowerCase();
      const prefix = n.startsWith(query) || n.split(" ").some((w) => w.startsWith(query));
      return { i, score: (prefix ? 1 : 0) + similarity(query, n) };
    })
    .filter((x) => x.score >= 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.i);
}

export type CreateResult =
  | { status: 201; item: Item }
  | { status: 409; exact: Item }
  | { status: 409; similar: Item[] };

// PUT /{kind}s/{id} : exact case-insensitive match or trigram near-match returns 409.
export function createItem(kind: Kind, name: string, allowSimilar = false): CreateResult {
  const clean = name.trim();
  const exact = catalogs[kind].find((i) => i.name.toLowerCase() === clean.toLowerCase());
  if (exact) return { status: 409, exact };
  if (!allowSimilar) {
    const similar = catalogs[kind].filter((i) => similarity(clean, i.name) >= 0.3);
    if (similar.length) return { status: 409, similar };
  }
  const item = mk(clean, kind === "food" ? { last_unit: "g" } : {});
  catalogs[kind].push(item);
  return { status: 201, item };
}

export function unarchive(item: Item): Item {
  item.archived = false;
  return item;
}

// Seed: two Sets of Bench press earlier today, so "repeat last set" has history.
const bench = catalogs.exercise[0];
const earlier = (mins: number) => {
  const d = new Date(Date.now() - mins * 60_000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
export const seedSaved: Saved[] = [
  {
    type: "meal",
    meal: {
      id: uuidv7(),
      label: "Breakfast",
      occurred_at: earlier(240),
      restaurant: null,
      food_entries: [
        { food: catalogs.food[5], quantity: 80, unit: "g" },
        { food: catalogs.food[3], quantity: 1, unit: "count" },
      ],
    },
  },
  { type: "set", set: { id: uuidv7(), exercise: bench, reps: 5, weight_lb: 135, occurred_at: earlier(30) } },
  { type: "set", set: { id: uuidv7(), exercise: bench, reps: 5, weight_lb: 135, occurred_at: earlier(27) } },
];

// What the client would PUT (ADR 0006): catalog refs by id, tz alongside the time.
export function mealPayload(m: MealDraft) {
  const base = { label: m.label || null, occurred_at: m.occurred_at, occurred_tz: userTz };
  return m.restaurant
    ? { method: "PUT", path: `/api/v1/meals/${m.id}`, body: { ...base, kind: "restaurant", restaurant_id: m.restaurant.id } }
    : {
        method: "PUT",
        path: `/api/v1/meals/${m.id}`,
        body: {
          ...base,
          kind: "foods",
          food_entries: m.food_entries.map((f) => ({ food_id: f.food.id, quantity: f.quantity, unit: f.unit })),
        },
      };
}
export function setPayload(s: SetDraft) {
  return {
    method: "PUT",
    path: `/api/v1/exercise-entries/${s.id}`,
    body: { exercise_id: s.exercise.id, reps: s.reps, weight_lb: s.weight_lb, occurred_at: s.occurred_at, occurred_tz: userTz },
  };
}

export function lastSetOf(saved: Saved[], exerciseId: string): SetDraft | undefined {
  for (let i = saved.length - 1; i >= 0; i--) {
    const s = saved[i];
    if (s.type === "set" && s.set.exercise.id === exerciseId) return s.set;
  }
}
export function lastSet(saved: Saved[]): SetDraft | undefined {
  for (let i = saved.length - 1; i >= 0; i--) {
    const s = saved[i];
    if (s.type === "set") return s.set;
  }
}
