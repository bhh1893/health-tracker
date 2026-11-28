// PROTOTYPE, throwaway (issue #302). In-memory stand-in for the API in ADR 0038:
// Meals with photos, a one-at-a-time upload queue, and a simulated network the
// floating bar can make slow or flaky. Nothing persists: reload starts over.
import { useSyncExternalStore } from "react";

import { uuidv7 } from "../../src/lib/uuidv7";

export const MAX_PHOTOS = 10;

// saved: the server holds it. queued/uploading: picked, Save tapped, bytes not
// stored yet. failed: the PUT failed, waiting for Retry or Discard.
// deleting/delete-failed: removed in the sheet, DELETE not confirmed yet.
export type PhotoStatus =
  | "saved"
  | "queued"
  | "uploading"
  | "failed"
  | "deleting"
  | "delete-failed";

export interface Photo {
  id: string;
  url: string;
  status: PhotoStatus;
  progress: number; // 0..1 while uploading
}

export interface ProtoMeal {
  id: string;
  kind: "foods" | "restaurant";
  label: string | null;
  number: number;
  food_entries: { food: { id: string; name: string }; quantity: number; unit: "g" | "count" }[];
  restaurants: { id: string; name: string }[];
  photos: Photo[];
}

// What the sheet hands back on Save: the photos it kept, in order, and the new ones.
export interface PhotoDraft {
  kept: Photo[];
  added: { id: string; url: string }[];
}

export const sim = { fail: "none" as "none" | "some" | "all", slow: false };

// A placeholder picture, so seeded Meals have something to show.
function fake(hue: number, text: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},55%,62%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},50%,38%)"/></linearGradient></defs><rect width="800" height="600" fill="url(#g)"/><text x="400" y="320" font-size="64" text-anchor="middle" fill="white" font-family="sans-serif">${text}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function saved(hue: number, text: string): Photo {
  return { id: uuidv7(), url: fake(hue, text), status: "saved", progress: 1 };
}

let meals: ProtoMeal[] = [
  {
    id: uuidv7(),
    kind: "foods",
    label: "Breakfast",
    number: 1,
    food_entries: [
      { food: { id: "f1", name: "Oatmeal" }, quantity: 80, unit: "g" },
      { food: { id: "f2", name: "Banana" }, quantity: 1, unit: "count" },
    ],
    restaurants: [],
    photos: [],
  },
  {
    id: uuidv7(),
    kind: "restaurant",
    label: "Lunch",
    number: 2,
    food_entries: [],
    restaurants: [{ id: "r1", name: "Pho Saigon" }],
    photos: [saved(20, "Pho"), saved(140, "Spring rolls"), saved(200, "Menu")],
  },
  {
    id: uuidv7(),
    kind: "foods",
    label: "Dinner",
    number: 3,
    food_entries: [
      { food: { id: "f3", name: "Chicken breast" }, quantity: 200, unit: "g" },
      { food: { id: "f4", name: "Rice" }, quantity: 150, unit: "g" },
    ],
    restaurants: [],
    photos: Array.from({ length: 10 }, (_, i) => saved(i * 36, `Photo ${String(i + 1)}`)),
  },
];

const listeners = new Set<() => void>();
function emit() {
  meals = [...meals];
  listeners.forEach((l) => {
    l();
  });
}

export function useMeals() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => meals,
  );
}

function patchPhoto(photoId: string, next: Partial<Photo> | null) {
  meals = meals.map((m) => ({
    ...m,
    photos: m.photos.flatMap((p) => (p.id !== photoId ? [p] : next === null ? [] : [{ ...p, ...next }])),
  }));
  emit();
}

function findPhoto(photoId: string) {
  for (const m of meals) {
    const p = m.photos.find((x) => x.id === photoId);
    if (p) return p;
  }
  return undefined;
}

function fails() {
  return sim.fail === "all" || (sim.fail === "some" && Math.random() < 0.4);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// One upload at a time, oldest first: a phone on cell data does better with one
// request in flight than with ten competing for the same uplink.
let running = false;
async function pump() {
  if (running) return;
  running = true;
  for (;;) {
    const next = meals.flatMap((m) => m.photos).find((p) => p.status === "queued");
    if (!next) break;
    patchPhoto(next.id, { status: "uploading", progress: 0 });
    const steps = sim.slow ? 40 : 12;
    let gone = false;
    for (let i = 1; i <= steps; i++) {
      await wait(150);
      if (!findPhoto(next.id)) {
        gone = true; // the Meal was deleted mid-upload: the server answers 404
        break;
      }
      patchPhoto(next.id, { progress: i / steps });
    }
    if (gone) continue;
    patchPhoto(next.id, fails() ? { status: "failed", progress: 0 } : { status: "saved", progress: 1 });
  }
  running = false;
}

async function deletePhoto(photoId: string) {
  patchPhoto(photoId, { status: "deleting" });
  await wait(sim.slow ? 1500 : 400);
  if (fails()) patchPhoto(photoId, { status: "delete-failed" });
  else patchPhoto(photoId, null);
}

let nextNumber = 4;

// Save: PUT /meals first (always succeeds here), then the deletes and the uploads.
export function saveMeal(
  meal: Omit<ProtoMeal, "photos" | "number"> & { number?: number },
  draft: PhotoDraft,
) {
  const existing = meals.find((m) => m.id === meal.id);
  const keptIds = new Set(draft.kept.map((p) => p.id));
  const removed = (existing?.photos ?? []).filter((p) => p.status === "saved" && !keptIds.has(p.id));
  // Photos still in flight from an earlier Save stay as they are.
  const inFlight = (existing?.photos ?? []).filter((p) => p.status !== "saved" && !keptIds.has(p.id));
  const photos: Photo[] = [
    ...draft.kept,
    ...inFlight,
    ...removed,
    ...draft.added.map((a): Photo => ({ ...a, status: "queued", progress: 0 })),
  ].sort((a, b) => (a.id < b.id ? -1 : 1)); // ordered by UUIDv7 photo ID (ADR 0038)
  const full: ProtoMeal = { ...meal, number: existing?.number ?? nextNumber++, photos };
  meals = existing ? meals.map((m) => (m.id === meal.id ? full : m)) : [...meals, full];
  emit();
  removed.forEach((p) => void deletePhoto(p.id));
  void pump();
}

export function retry(photoId: string) {
  const p = findPhoto(photoId);
  if (!p) return;
  if (p.status === "failed") {
    // Same photo ID, so a PUT that reached the server before failing is a 200 repeat.
    patchPhoto(photoId, { status: "queued" });
    void pump();
  } else if (p.status === "delete-failed") {
    void deletePhoto(photoId);
  }
}

// Give up on an upload that failed: the photo was never saved, so it just goes.
export function discard(photoId: string) {
  patchPhoto(photoId, null);
}

export function deleteMeal(id: string) {
  meals = meals.filter((m) => m.id !== id);
  emit();
}

export function newMeal(kind: ProtoMeal["kind"]): Omit<ProtoMeal, "photos" | "number"> {
  return kind === "foods"
    ? {
        id: uuidv7(),
        kind,
        label: null,
        food_entries: [{ food: { id: "f5", name: "Greek yogurt" }, quantity: 170, unit: "g" }],
        restaurants: [],
      }
    : { id: uuidv7(), kind, label: "Lunch", food_entries: [], restaurants: [{ id: "r2", name: "Taco Stand" }] };
}

// What a card shows: everything except photos the user already removed.
export function visible(photos: Photo[]) {
  return photos.filter((p) => p.status !== "deleting");
}

export const pending = (p: Photo) => p.status === "queued" || p.status === "uploading";
export const broken = (p: Photo) => p.status === "failed" || p.status === "delete-failed";
