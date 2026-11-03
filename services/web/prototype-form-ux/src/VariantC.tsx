// PROTOTYPE, throwaway (issue #14).
// Variant C, "Day feed + sheet": the home screen is today's Day (Meals and Sessions).
// Logging happens in a bottom sheet over it, biased to repeating what you already did:
// inline "+ Set" on each Session, recent-Food and recent-Restaurant chips.
import { useState } from "react";
import type { VariantProps } from "./App";
import { CatalogCombo } from "./CatalogCombo";
import { Field, Payload, Toast, UnitToggle, fmtSet, inputCls } from "./Shared";
import {
  mealPayload,
  nowLocal,
  setPayload,
  uuidv7,
  type FoodEntry,
  type Item,
  type MealDraft,
  type Saved,
  type SetDraft,
} from "./stub";

type Sheet = null | { mode: "set"; draft: Partial<SetDraft> } | { mode: "meal"; draft: MealDraft; kind: "foods" | "restaurant" };

export function VariantC({ saved, onSave }: VariantProps) {
  const [sheet, setSheet] = useState<Sheet>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(null), 1500);
  };

  const today = nowLocal().slice(0, 10);
  const todays = saved
    .filter((s) => (s.type === "set" ? s.set.occurred_at : s.meal.occurred_at).startsWith(today))
    .sort((a, b) => at(a).localeCompare(at(b)));
  const meals = todays.flatMap((s) => (s.type === "meal" ? [s.meal] : []));
  // Session = all Sets of one Exercise on one Day (derived, GLOSSARY.md).
  const sessions = new Map<string, SetDraft[]>();
  todays.forEach((s) => s.type === "set" && sessions.set(s.set.exercise.id, [...(sessions.get(s.set.exercise.id) ?? []), s.set]));

  const recentFoods = recentBy(saved, "food");
  const recentRestaurants = recentBy(saved, "restaurant");

  const repeatSet = (last: SetDraft) => {
    const draft = { ...last, id: uuidv7(), occurred_at: nowLocal() };
    onSave({ type: "set", set: draft });
    flash(`Saved ${draft.exercise.name} ${fmtSet(draft.weight_lb, draft.reps)}`);
  };

  return (
    <div className="mx-auto min-h-screen max-w-md pb-40">
      <Toast text={toast} />
      <header className="px-4 pt-5 pb-2">
        <p className="text-sm text-stone-500">Today</p>
        <h1 className="text-2xl font-bold">
          {new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
        </h1>
      </header>

      <section className="px-4 pt-3">
        <h2 className="mb-2 text-sm font-semibold tracking-wide text-stone-500 uppercase">Meals</h2>
        {meals.length === 0 && <p className="text-stone-400">Nothing yet</p>}
        <ul className="flex flex-col gap-2">
          {meals.map((m, i) => (
            <li key={m.id} className="rounded-2xl bg-white p-3 shadow-sm">
              <div className="flex justify-between">
                <span className="font-semibold">
                  Meal {i + 1}
                  {m.label && <span className="font-normal text-stone-500"> · {m.label}</span>}
                </span>
                <span className="text-stone-500">{m.occurred_at.slice(11)}</span>
              </div>
              <p className="text-stone-600">
                {m.restaurant ? `🍽️ ${m.restaurant.name}` : m.food_entries.map((f) => `${f.food.name} ${f.quantity}${f.unit === "g" ? "g" : "×"}`).join(", ")}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="px-4 pt-5">
        <h2 className="mb-2 text-sm font-semibold tracking-wide text-stone-500 uppercase">Exercise</h2>
        {sessions.size === 0 && <p className="text-stone-400">Nothing yet</p>}
        <ul className="flex flex-col gap-2">
          {[...sessions.values()].map((sets) => {
            const last = sets[sets.length - 1];
            return (
              <li key={last.exercise.id} className="rounded-2xl bg-white p-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{last.exercise.name}</span>
                  <span className="flex gap-2">
                    <button
                      onClick={() => setSheet({ mode: "set", draft: { ...last, id: uuidv7(), occurred_at: nowLocal() } })}
                      className="rounded-full border border-stone-300 px-3 py-1 text-sm"
                    >
                      Edit…
                    </button>
                    <button onClick={() => repeatSet(last)} className="rounded-full bg-emerald-600 px-3 py-1 text-sm text-white">
                      + {fmtSet(last.weight_lb, last.reps)}
                    </button>
                  </span>
                </div>
                <ol className="mt-1 flex flex-wrap gap-x-3 text-stone-600">
                  {sets.map((s, i) => (
                    <li key={s.id}>
                      <span className="text-stone-400">{i + 1}.</span> {fmtSet(s.weight_lb, s.reps)}
                    </li>
                  ))}
                </ol>
              </li>
            );
          })}
        </ul>
      </section>

      {!sheet && (
        <div className="fixed inset-x-0 bottom-16 mx-auto flex max-w-md gap-2 px-4">
          <button
            onClick={() => setSheet({ mode: "set", draft: { id: uuidv7(), occurred_at: nowLocal(), reps: 5, weight_lb: 45 } })}
            className="flex-1 rounded-2xl bg-stone-900 py-4 font-semibold text-white shadow-lg"
          >
            + Set
          </button>
          <button
            onClick={() => setSheet({ mode: "meal", kind: "foods", draft: blankMeal() })}
            className="flex-1 rounded-2xl bg-emerald-600 py-4 font-semibold text-white shadow-lg"
          >
            + Meal
          </button>
        </div>
      )}

      {sheet && (
        <>
          <div className="fixed inset-0 z-20 bg-black/30" onClick={() => setSheet(null)} />
          <div
            role="dialog"
            aria-label={sheet.mode === "set" ? "Log a Set" : "Log a Meal"}
            className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-h-[85vh] max-w-md flex-col gap-4 overflow-auto rounded-t-3xl bg-stone-50 p-4 pb-20 shadow-2xl"
          >
            <div className="mx-auto h-1.5 w-10 rounded-full bg-stone-300" />
            {sheet.mode === "set" ? (
              <SetSheet
                draft={sheet.draft}
                onChange={(draft) => setSheet({ mode: "set", draft })}
                onSave={(d) => {
                  onSave({ type: "set", set: d });
                  flash(`Saved ${d.exercise.name} ${fmtSet(d.weight_lb, d.reps)}`);
                  setSheet(null);
                }}
              />
            ) : (
              <MealSheet
                kind={sheet.kind}
                draft={sheet.draft}
                recentFoods={recentFoods as { item: Item; entry?: FoodEntry }[]}
                recentRestaurants={recentRestaurants}
                onKind={(kind) => setSheet({ ...sheet, kind })}
                onChange={(draft) => setSheet({ ...sheet, draft })}
                onSave={(m) => {
                  onSave({ type: "meal", meal: m });
                  flash("Meal saved");
                  setSheet(null);
                }}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function SetSheet(props: { draft: Partial<SetDraft>; onChange: (d: Partial<SetDraft>) => void; onSave: (d: SetDraft) => void }) {
  const d = props.draft;
  const complete = d.exercise && d.reps ? (d as SetDraft) : null;
  return (
    <>
      <h2 className="text-lg font-semibold">Log a Set</h2>
      <CatalogCombo kind="exercise" label="Exercise" value={d.exercise ?? null} onChange={(exercise) => props.onChange({ ...d, exercise: exercise ?? undefined })} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Weight (lb, blank = bodyweight)">
          <input
            className={inputCls}
            inputMode="decimal"
            value={d.weight_lb ?? ""}
            onChange={(e) => props.onChange({ ...d, weight_lb: e.target.value === "" ? null : Number(e.target.value) })}
          />
        </Field>
        <Field label="Reps">
          <input className={inputCls} inputMode="numeric" value={d.reps ?? ""} onChange={(e) => props.onChange({ ...d, reps: Number(e.target.value) || 0 })} />
        </Field>
      </div>
      <Field label="When">
        <input type="datetime-local" className={inputCls} value={d.occurred_at} onChange={(e) => props.onChange({ ...d, occurred_at: e.target.value })} />
      </Field>
      {complete && <Payload value={setPayload(complete)} />}
      <button
        disabled={!complete}
        onClick={() => complete && props.onSave(complete)}
        className="rounded-2xl bg-stone-900 py-4 font-semibold text-white disabled:bg-stone-300"
      >
        Save Set
      </button>
    </>
  );
}

function MealSheet(props: {
  kind: "foods" | "restaurant";
  draft: MealDraft;
  recentFoods: { item: Item; entry?: FoodEntry }[];
  recentRestaurants: { item: Item }[];
  onKind: (k: "foods" | "restaurant") => void;
  onChange: (m: MealDraft) => void;
  onSave: (m: MealDraft) => void;
}) {
  const m = props.draft;
  const [adding, setAdding] = useState<Item | null>(null);
  const addFood = (food: Item, prev?: FoodEntry) =>
    props.onChange({
      ...m,
      food_entries: [
        ...m.food_entries,
        { food, quantity: prev?.quantity ?? (food.last_unit === "count" ? 1 : 100), unit: prev?.unit ?? food.last_unit ?? "g" },
      ],
    });
  const update = (i: number, patch: Partial<FoodEntry>) =>
    props.onChange({ ...m, food_entries: m.food_entries.map((f, j) => (j === i ? { ...f, ...patch } : f)) });

  const ready = props.kind === "restaurant" ? !!m.restaurant : m.food_entries.length > 0;
  const final: MealDraft = props.kind === "restaurant" ? { ...m, food_entries: [] } : { ...m, restaurant: null };

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Log a Meal</h2>
        <div className="flex rounded-full bg-stone-200 p-1 text-sm">
          {(["foods", "restaurant"] as const).map((k) => (
            <button key={k} onClick={() => props.onKind(k)} className={`rounded-full px-3 py-1 capitalize ${props.kind === k ? "bg-white shadow" : ""}`}>
              {k === "foods" ? "Foods" : "Restaurant"}
            </button>
          ))}
        </div>
      </div>

      {props.kind === "foods" ? (
        <>
          <div className="flex flex-wrap gap-2">
            {props.recentFoods.slice(0, 6).map(({ item, entry }) => (
              <button key={item.id} onClick={() => addFood(item, entry)} className="rounded-full bg-white px-3 py-2 text-sm shadow-sm">
                + {item.name}
                {entry && <span className="text-stone-400"> {entry.quantity}{entry.unit === "g" ? "g" : "×"}</span>}
              </button>
            ))}
          </div>
          <CatalogCombo
            kind="food"
            label="Add a food"
            value={adding}
            onChange={(f) => {
              if (!f) return setAdding(null);
              addFood(f);
              setAdding(null);
            }}
          />
          <ul className="flex flex-col gap-2">
            {m.food_entries.map((f, i) => (
              <li key={i} className="flex items-center gap-2 rounded-xl bg-white p-2">
                <span className="flex-1 truncate">{f.food.name}</span>
                <input
                  aria-label={`${f.food.name} quantity`}
                  className="w-16 rounded-lg border border-stone-300 px-2 py-2 text-right"
                  inputMode="decimal"
                  value={f.quantity}
                  onChange={(e) => update(i, { quantity: Number(e.target.value) || 0 })}
                />
                <UnitToggle value={f.unit} onChange={(unit) => update(i, { unit })} />
                <button
                  aria-label={`Remove ${f.food.name}`}
                  onClick={() => props.onChange({ ...m, food_entries: m.food_entries.filter((_, j) => j !== i) })}
                  className="px-1 text-stone-400"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {props.recentRestaurants.map(({ item }) => (
              <button
                key={item.id}
                onClick={() => props.onChange({ ...m, restaurant: item })}
                className={`rounded-full px-3 py-2 text-sm shadow-sm ${m.restaurant?.id === item.id ? "bg-stone-900 text-white" : "bg-white"}`}
              >
                {item.name}
              </button>
            ))}
          </div>
          <CatalogCombo key={m.restaurant?.id ?? "none"} kind="restaurant" label="Restaurant" value={m.restaurant} onChange={(r) => props.onChange({ ...m, restaurant: r })} />
        </>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Label (optional)">
          <input className={inputCls} value={m.label} placeholder="Lunch" onChange={(e) => props.onChange({ ...m, label: e.target.value })} />
        </Field>
        <Field label="When">
          <input type="datetime-local" className={inputCls} value={m.occurred_at} onChange={(e) => props.onChange({ ...m, occurred_at: e.target.value })} />
        </Field>
      </div>
      {ready && <Payload value={mealPayload(final)} />}
      <button disabled={!ready} onClick={() => props.onSave(final)} className="rounded-2xl bg-emerald-600 py-4 font-semibold text-white disabled:bg-stone-300">
        Save Meal
      </button>
    </>
  );
}

function blankMeal(): MealDraft {
  return { id: uuidv7(), label: "", occurred_at: nowLocal(), food_entries: [], restaurant: null };
}

function at(s: Saved) {
  return s.type === "set" ? s.set.occurred_at : s.meal.occurred_at;
}

// Most recently used Foods (with their last quantity) or Restaurants, newest first.
function recentBy(saved: Saved[], kind: "food" | "restaurant") {
  const seen = new Map<string, { item: Item; entry?: FoodEntry }>();
  for (let i = saved.length - 1; i >= 0; i--) {
    const s = saved[i];
    if (s.type !== "meal") continue;
    if (kind === "restaurant" && s.meal.restaurant && !seen.has(s.meal.restaurant.id)) seen.set(s.meal.restaurant.id, { item: s.meal.restaurant });
    if (kind === "food") s.meal.food_entries.forEach((f) => !seen.has(f.food.id) && seen.set(f.food.id, { item: f.food, entry: f }));
  }
  return [...seen.values()];
}
