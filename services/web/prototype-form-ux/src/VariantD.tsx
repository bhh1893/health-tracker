// PROTOTYPE, throwaway (issue #14).
// Variant D, "C + two windows" (user feedback on A-C):
// - Two windows, Exercise and Meals, switched by a segmented control (from A).
// - Each window is a Day feed like C; adding opens a bottom sheet.
// - Session card: Edit top-right opens a sheet listing every Set for editing;
//   quick-add "+ same again" sits at the end of the Set list.
// - Meal card: tap to edit the whole Meal; recent-Food chips sit under "Add a food".
import { useState, type ReactNode } from "react";
import type { VariantProps } from "./App";
import { CatalogCombo } from "./CatalogCombo";
import { Field, Payload, Toast, UnitToggle, fmtSet, inputCls } from "./Shared";
import {
  lastSetOf,
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

type Window = "exercise" | "meals";
type Sheet =
  | null
  | { mode: "new-set"; exercise?: Item }
  | { mode: "edit-session"; exerciseId: string }
  | { mode: "delete-session"; exerciseId: string }
  | { mode: "meal"; draft: MealDraft; isNew: boolean };

export function VariantD({ saved, onSave, onReplace }: VariantProps) {
  const [win, setWin] = useState<Window>("exercise");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(null), 1500);
  };

  const today = nowLocal().slice(0, 10);
  const todays = saved.filter((s) => at(s).startsWith(today)).sort((a, b) => at(a).localeCompare(at(b)));
  const meals = todays.flatMap((s) => (s.type === "meal" ? [s.meal] : []));
  // Session = all Sets of one Exercise on one Day (derived, GLOSSARY.md).
  const sessions = new Map<string, SetDraft[]>();
  todays.forEach((s) => s.type === "set" && sessions.set(s.set.exercise.id, [...(sessions.get(s.set.exercise.id) ?? []), s.set]));

  const repeatSet = (last: SetDraft) => {
    const draft = { ...last, id: uuidv7(), occurred_at: nowLocal() };
    onSave({ type: "set", set: draft });
    flash(`Saved ${draft.exercise.name} ${fmtSet(draft.weight_lb, draft.reps)}`);
  };

  return (
    <div className="mx-auto min-h-screen max-w-md pb-40">
      <Toast text={toast} />
      <header className="sticky top-0 z-10 bg-stone-100/95 px-4 pt-4 pb-3 backdrop-blur">
        <p className="text-sm text-stone-500">Today</p>
        <h1 className="mb-3 text-2xl font-bold">
          {new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
        </h1>
        <div role="tablist" className="grid grid-cols-2 rounded-xl bg-stone-200 p-1">
          {(["exercise", "meals"] as Window[]).map((w) => (
            <button
              key={w}
              role="tab"
              aria-selected={win === w}
              onClick={() => setWin(w)}
              className={`rounded-lg py-2 capitalize ${win === w ? "bg-white font-semibold shadow" : "text-stone-600"}`}
            >
              {w}
            </button>
          ))}
        </div>
      </header>

      {win === "exercise" ? (
        <section className="flex flex-col gap-3 px-4">
          {sessions.size === 0 && <p className="text-stone-400">No exercise yet today</p>}
          {[...sessions.entries()].map(([exerciseId, sets]) => {
            const last = sets[sets.length - 1];
            return (
              <article key={exerciseId} className="rounded-2xl bg-white p-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">{last.exercise.name}</h2>
                  <span className="flex items-center">
                    <button
                      onClick={() => setSheet({ mode: "edit-session", exerciseId })}
                      className="rounded-full px-3 py-1 text-sm text-emerald-700"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setSheet({ mode: "delete-session", exerciseId })}
                      aria-label={`Delete all ${last.exercise.name} sets today`}
                      className="rounded-full px-2 py-1 text-stone-400 active:text-red-600"
                    >
                      🗑
                    </button>
                  </span>
                </div>
                <ol className="mt-1 flex flex-col">
                  {sets.map((s, i) => (
                    <li key={s.id} className="flex justify-between border-b border-stone-100 py-2 text-stone-700">
                      <span>
                        <span className="text-stone-400">Set {i + 1}</span> · {fmtSet(s.weight_lb, s.reps)}
                      </span>
                      <span className="text-sm text-stone-400">{s.occurred_at.slice(11)}</span>
                    </li>
                  ))}
                </ol>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {/* Dashed border: one tap, duplicates the previous Set. */}
                  <button
                    onClick={() => repeatSet(last)}
                    aria-label={`Repeat previous set, ${fmtSet(last.weight_lb, last.reps)}`}
                    className="rounded-xl border-2 border-dashed border-emerald-300 py-2 text-emerald-700 active:bg-emerald-50"
                  >
                    + {fmtSet(last.weight_lb, last.reps)}
                  </button>
                  {/* Solid border: opens the form to enter any values. */}
                  <button
                    onClick={() => setSheet({ mode: "new-set", exercise: last.exercise })}
                    className="rounded-xl border-2 border-emerald-600 py-2 text-emerald-700 active:bg-emerald-50"
                  >
                    + Set {sets.length + 1}
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      ) : (
        <section className="flex flex-col gap-3 px-4">
          {meals.length === 0 && <p className="text-stone-400">No meals yet today</p>}
          {meals.map((m, i) => (
            <button
              key={m.id}
              onClick={() => setSheet({ mode: "meal", draft: structuredClone(m), isNew: false })}
              className="rounded-2xl bg-white p-3 text-left shadow-sm active:bg-stone-50"
            >
              <div className="flex justify-between">
                <span className="font-semibold">
                  Meal {i + 1}
                  {m.label && <span className="font-normal text-stone-500"> · {m.label}</span>}
                </span>
                <span className="text-stone-500">{m.occurred_at.slice(11)}</span>
              </div>
              {m.restaurant ? (
                <p className="text-stone-600">🍽️ {m.restaurant.name}</p>
              ) : (
                <ul className="mt-1 text-stone-600">
                  {m.food_entries.map((f, j) => (
                    <li key={j}>
                      {f.food.name} <span className="text-stone-400">{f.quantity} {f.unit}</span>
                    </li>
                  ))}
                </ul>
              )}
            </button>
          ))}
        </section>
      )}

      {!sheet && (
        <div className="fixed inset-x-0 bottom-16 mx-auto max-w-md px-4">
          <button
            onClick={() => setSheet(win === "exercise" ? { mode: "new-set" } : { mode: "meal", draft: blankMeal(), isNew: true })}
            className="w-full rounded-2xl bg-emerald-600 py-4 text-lg font-semibold text-white shadow-lg"
          >
            {win === "exercise" ? "+ Exercise" : "+ Meal"}
          </button>
        </div>
      )}

      {sheet && (
        <>
          {sheet.mode === "new-set" && (
            <NewSetSheet
              saved={saved}
              day={today}
              initial={sheet.exercise}
              onClose={() => setSheet(null)}
              onSave={(d) => {
                onSave({ type: "set", set: d });
                flash(`Saved ${d.exercise.name} ${fmtSet(d.weight_lb, d.reps)}`);
                setSheet(null);
              }}
            />
          )}
          {sheet.mode === "delete-session" && (
            <DeleteSessionSheet
              sets={sessions.get(sheet.exerciseId) ?? []}
              onClose={() => setSheet(null)}
              onConfirm={(ids) => {
                ids.forEach((id) => onReplace(id, null));
                flash("Exercise deleted");
                setSheet(null);
              }}
            />
          )}
          {sheet.mode === "edit-session" && (
            <EditSessionSheet
              sets={sessions.get(sheet.exerciseId) ?? []}
              onApply={(changed, deleted) => {
                changed.forEach((s) => onReplace(s.id, { type: "set", set: s }));
                deleted.forEach((id) => onReplace(id, null));
                flash("Session updated");
                setSheet(null);
              }}
              onClose={() => setSheet(null)}
            />
          )}
          {sheet.mode === "meal" && (
            <MealSheet
              draft={sheet.draft}
              isNew={sheet.isNew}
              recentFoods={recentFoods(saved)}
              recentRestaurants={recentRestaurants(saved)}
              onChange={(draft) => setSheet({ ...sheet, draft })}
              onSave={(m) => {
                if (sheet.isNew) onSave({ type: "meal", meal: m });
                else onReplace(m.id, { type: "meal", meal: m });
                flash("Meal saved");
                setSheet(null);
              }}
              onDelete={() => {
                onReplace(sheet.draft.id, null);
                flash("Meal deleted");
                setSheet(null);
              }}
              onClose={() => setSheet(null)}
            />
          )}
        </>
      )}
    </div>
  );
}

// Header and footer stay put; only the middle scrolls. pb-16 on the footer clears the
// prototype's floating variant switcher.
function BottomSheet(props: { label: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  return (
    <>
      <div className="fixed inset-0 z-20 bg-black/30" onClick={props.onClose} />
      <div
        role="dialog"
        aria-label={props.label}
        className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-h-[88vh] max-w-md flex-col rounded-t-3xl bg-stone-50 shadow-2xl"
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h2 className="text-lg font-semibold">{props.label}</h2>
          <button onClick={props.onClose} aria-label="Close" className="px-2 text-stone-400">
            ✕
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">{props.children}</div>
        {props.footer && (
          <div className="flex flex-col gap-3 border-t border-stone-200 bg-stone-50 px-4 pt-3 pb-16">{props.footer}</div>
        )}
      </div>
    </>
  );
}

// Time-only input; the date is the Day being viewed (today, for now).
function TimeField(props: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Time">
      <input
        type="time"
        className={`${inputCls} w-full`}
        value={props.value.slice(11, 16)}
        onChange={(e) => e.target.value && props.onChange(`${props.value.slice(0, 10)}T${e.target.value}`)}
      />
    </Field>
  );
}

function NewSetSheet(props: { saved: Saved[]; day: string; initial?: Item; onSave: (d: SetDraft) => void; onClose: () => void }) {
  const prev = props.initial && lastSetOf(props.saved, props.initial.id);
  const [exercise, setExercise] = useState<Item | null>(props.initial ?? null);
  const [weight, setWeight] = useState(prev && prev.weight_lb !== null ? String(prev.weight_lb) : "");
  const [reps, setReps] = useState(prev ? String(prev.reps) : "");
  const [when, setWhen] = useState(() => `${props.day}T${nowLocal().slice(11)}`);
  const [id] = useState(uuidv7);
  const last = exercise ? lastSetOf(props.saved, exercise.id) : undefined;

  const draft: SetDraft | null =
    exercise && Number(reps) > 0
      ? { id, exercise, reps: Number(reps), weight_lb: weight === "" ? null : Number(weight), occurred_at: when }
      : null;

  return (
    <BottomSheet
      label={props.initial ? `Add a Set · ${props.initial.name}` : "Log a Set"}
      onClose={props.onClose}
      footer={
        <button
          disabled={!draft}
          onClick={() => draft && props.onSave(draft)}
          className="rounded-2xl bg-stone-900 py-4 font-semibold text-white disabled:bg-stone-300"
        >
          Save Set
        </button>
      }
    >
      <div className="grid grid-cols-[7rem_1fr] items-start gap-3">
        <TimeField value={when} onChange={setWhen} />
        <CatalogCombo
          kind="exercise"
          label="Exercise"
          value={exercise}
          hint={last ? `Last set: ${fmtSet(last.weight_lb, last.reps)}` : undefined}
          onChange={(e) => {
            setExercise(e);
            const l = e && lastSetOf(props.saved, e.id);
            if (l) {
              setWeight(l.weight_lb === null ? "" : String(l.weight_lb));
              setReps(String(l.reps));
            }
          }}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Weight (lb, blank = bodyweight)">
          <input className={inputCls} inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />
        </Field>
        <Field label="Reps">
          <input className={inputCls} inputMode="numeric" value={reps} onChange={(e) => setReps(e.target.value)} />
        </Field>
      </div>
      {draft && <Payload value={setPayload(draft)} />}
    </BottomSheet>
  );
}

// Deleting a whole Exercise for the Day is one DELETE per Set (no Session resource exists:
// a Session is derived). Confirm first because it removes several Entries at once.
function DeleteSessionSheet(props: { sets: SetDraft[]; onConfirm: (ids: string[]) => void; onClose: () => void }) {
  const name = props.sets[0]?.exercise.name ?? "";
  return (
    <BottomSheet
      label={`Delete ${name}?`}
      onClose={props.onClose}
      footer={
        <>
          <button onClick={() => props.onConfirm(props.sets.map((s) => s.id))} className="rounded-2xl bg-red-600 py-4 font-semibold text-white">
            Delete {props.sets.length} Set{props.sets.length === 1 ? "" : "s"}
          </button>
          <button onClick={props.onClose} className="py-2 text-stone-500">
            Cancel
          </button>
        </>
      }
    >
      <p className="text-stone-600">
        This removes every {name} Set logged today: {props.sets.map((s) => fmtSet(s.weight_lb, s.reps)).join(", ")}.
      </p>
      <Payload value={props.sets.map((s) => ({ method: "DELETE", path: `/api/v1/exercise-entries/${s.id}` }))} />
    </BottomSheet>
  );
}

// Every Set of the Session, editable in place. Apply sends one PUT per changed Set
// and one DELETE per removed Set; untouched Sets send nothing.
function EditSessionSheet(props: { sets: SetDraft[]; onApply: (changed: SetDraft[], deleted: string[]) => void; onClose: () => void }) {
  const [rows, setRows] = useState(() => props.sets.map((s) => ({ ...s, deleted: false })));
  const original = new Map(props.sets.map((s) => [s.id, s]));
  const changed = rows.filter((r) => {
    const o = original.get(r.id)!;
    return !r.deleted && (o.reps !== r.reps || o.weight_lb !== r.weight_lb || o.occurred_at !== r.occurred_at);
  });
  const deleted = rows.filter((r) => r.deleted).map((r) => r.id);
  const patch = (id: string, p: Partial<SetDraft & { deleted: boolean }>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));

  let n = 0;
  return (
    <BottomSheet
      label={`Edit · ${props.sets[0]?.exercise.name ?? ""}`}
      onClose={props.onClose}
      footer={
        <button
          disabled={!changed.length && !deleted.length}
          onClick={() => props.onApply(changed.map(({ deleted: _, ...s }) => s), deleted)}
          className="rounded-2xl bg-stone-900 py-4 font-semibold text-white disabled:bg-stone-300"
        >
          Save changes
        </button>
      }
    >
      <div className="grid grid-cols-[3rem_1fr_1fr_2rem] items-center gap-2 text-sm text-stone-500">
        <span>Set</span>
        <span>lb (blank = BW)</span>
        <span>Reps</span>
        <span />
      </div>
      {rows.map((r) => (
        <div key={r.id} className={`grid grid-cols-[3rem_1fr_1fr_2rem] items-center gap-2 ${r.deleted ? "opacity-40" : ""}`}>
          <span className="text-stone-500">{r.deleted ? "-" : ++n}</span>
          <input
            aria-label={`Set ${n} weight`}
            disabled={r.deleted}
            className={`${inputCls} py-2`}
            inputMode="decimal"
            value={r.weight_lb ?? ""}
            onChange={(e) => patch(r.id, { weight_lb: e.target.value === "" ? null : Number(e.target.value) })}
          />
          <input
            aria-label={`Set ${n} reps`}
            disabled={r.deleted}
            className={`${inputCls} py-2`}
            inputMode="numeric"
            value={r.reps}
            onChange={(e) => patch(r.id, { reps: Number(e.target.value) || 0 })}
          />
          <button
            aria-label={r.deleted ? "Undo delete" : "Delete set"}
            onClick={() => patch(r.id, { deleted: !r.deleted })}
            className="text-stone-400"
          >
            {r.deleted ? "↺" : "✕"}
          </button>
        </div>
      ))}
      <Payload
        value={[
          ...changed.map(({ deleted: _, ...s }) => setPayload(s)),
          ...deleted.map((id) => ({ method: "DELETE", path: `/api/v1/exercise-entries/${id}` })),
        ]}
      />
    </BottomSheet>
  );
}

// Layout, top to bottom:
//   Foods | Restaurant toggle
//   Time | Label
//   (scrolls) the Meal's Food Entries, or the Restaurant picker
//   (fixed footer) Add a food + Recent chips, then Save
function MealSheet(props: {
  draft: MealDraft;
  isNew: boolean;
  recentFoods: { item: Item; entry: FoodEntry }[];
  recentRestaurants: Item[];
  onChange: (m: MealDraft) => void;
  onSave: (m: MealDraft) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const m = props.draft;
  const [kind, setKind] = useState<"foods" | "restaurant">(m.restaurant ? "restaurant" : "foods");
  const [adding, setAdding] = useState<Item | null>(null);
  const [addedCount, setAddedCount] = useState(0);
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

  const final: MealDraft = kind === "restaurant" ? { ...m, food_entries: [] } : { ...m, restaurant: null };
  const ready = kind === "restaurant" ? !!m.restaurant : m.food_entries.length > 0;
  const inMeal = new Set(m.food_entries.map((f) => f.food.id));
  const chips = props.recentFoods.filter(({ item }) => !inMeal.has(item.id)).slice(0, 6);

  const saveButtons = (
    <>
      <button disabled={!ready} onClick={() => props.onSave(final)} className="rounded-2xl bg-emerald-600 py-4 font-semibold text-white disabled:bg-stone-300">
        {props.isNew ? "Save Meal" : "Save changes"}
      </button>
      {!props.isNew && (
        <button onClick={props.onDelete} className="py-1 text-red-600">
          Delete Meal
        </button>
      )}
    </>
  );

  return (
    <BottomSheet
      label={props.isNew ? "Log a Meal" : "Edit Meal"}
      onClose={props.onClose}
      footer={
        kind === "foods" ? (
          <>
            {/* Search 2/3, Add 1/3. Picking a suggestion only selects it; Add commits it to the Meal.
                The key remounts the search after Add so its text clears. */}
            <div className="grid grid-cols-[2fr_1fr] items-end gap-3">
              <CatalogCombo key={addedCount} kind="food" label="Add a food" value={adding} onChange={setAdding} />
              <button
                disabled={!adding}
                onClick={() => {
                  if (!adding) return;
                  addFood(adding);
                  setAdding(null);
                  setAddedCount((n) => n + 1);
                }}
                className="rounded-xl bg-stone-900 py-3 font-semibold text-white disabled:bg-stone-300"
              >
                Add
              </button>
            </div>
            {chips.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {chips.map(({ item, entry }) => (
                  <button key={item.id} onClick={() => addFood(item, entry)} className="shrink-0 rounded-full bg-white px-3 py-2 text-sm shadow-sm">
                    + {item.name} <span className="text-stone-400">{entry.quantity} {entry.unit}</span>
                  </button>
                ))}
              </div>
            )}
            {saveButtons}
          </>
        ) : (
          saveButtons
        )
      }
    >
      <div className="flex rounded-full bg-stone-200 p-1 text-sm">
        {(["foods", "restaurant"] as const).map((k) => (
          <button key={k} onClick={() => setKind(k)} className={`flex-1 rounded-full py-2 ${kind === k ? "bg-white shadow" : ""}`}>
            {k === "foods" ? "Foods" : "Restaurant"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-[7rem_1fr] gap-3">
        <TimeField value={m.occurred_at} onChange={(occurred_at) => props.onChange({ ...m, occurred_at })} />
        <Field label="Label (optional)">
          <input className={inputCls} value={m.label} placeholder="Lunch" onChange={(e) => props.onChange({ ...m, label: e.target.value })} />
        </Field>
      </div>

      {kind === "foods" ? (
        m.food_entries.length === 0 ? (
          <p className="py-4 text-center text-stone-400">No foods yet. Add one below.</p>
        ) : (
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
        )
      ) : (
        <>
          <CatalogCombo key={m.restaurant?.id ?? "none"} kind="restaurant" label="Restaurant" value={m.restaurant} onChange={(r) => props.onChange({ ...m, restaurant: r })} />
          {props.recentRestaurants.length > 0 && (
            <div>
              <p className="mb-1 text-sm text-stone-500">Recent</p>
              <div className="flex flex-wrap gap-2">
                {props.recentRestaurants.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => props.onChange({ ...m, restaurant: r })}
                    className={`rounded-full px-3 py-2 text-sm shadow-sm ${m.restaurant?.id === r.id ? "bg-stone-900 text-white" : "bg-white"}`}
                  >
                    {r.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      {ready && <Payload value={mealPayload(final)} />}
    </BottomSheet>
  );
}

function blankMeal(): MealDraft {
  return { id: uuidv7(), label: "", occurred_at: nowLocal(), food_entries: [], restaurant: null };
}

function at(s: Saved) {
  return s.type === "set" ? s.set.occurred_at : s.meal.occurred_at;
}

function recentFoods(saved: Saved[]) {
  const seen = new Map<string, { item: Item; entry: FoodEntry }>();
  for (let i = saved.length - 1; i >= 0; i--) {
    const s = saved[i];
    if (s.type === "meal") s.meal.food_entries.forEach((f) => !seen.has(f.food.id) && seen.set(f.food.id, { item: f.food, entry: f }));
  }
  return [...seen.values()];
}

function recentRestaurants(saved: Saved[]) {
  const seen = new Map<string, Item>();
  for (let i = saved.length - 1; i >= 0; i--) {
    const s = saved[i];
    if (s.type === "meal" && s.meal.restaurant) seen.set(s.meal.restaurant.id, s.meal.restaurant);
  }
  return [...seen.values()];
}
