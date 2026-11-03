// PROTOTYPE, throwaway (issue #14).
// Variant A, "One form": a segmented control picks the Entry type; every field is on one
// scrolling page; one sticky Save. Closest to a classic web form.
import { useState } from "react";
import type { VariantProps } from "./App";
import { CatalogCombo } from "./CatalogCombo";
import { Field, Payload, Toast, UnitToggle, fmtSet, inputCls } from "./Shared";
import { lastSetOf, mealPayload, nowLocal, setPayload, uuidv7, type FoodEntry, type Item } from "./stub";

type Tab = "set" | "meal" | "restaurant";

export function VariantA({ saved, onSave }: VariantProps) {
  const [tab, setTab] = useState<Tab>("set");
  const [toast, setToast] = useState<string | null>(null);
  const flash = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(null), 1500);
  };

  // Set state
  const [setId, setSetId] = useState(uuidv7);
  const [exercise, setExercise] = useState<Item | null>(null);
  const [weight, setWeight] = useState("");
  const [bodyweight, setBodyweight] = useState(false);
  const [reps, setReps] = useState("");

  // Meal state (foods or restaurant)
  const [mealId, setMealId] = useState(uuidv7);
  const [label, setLabel] = useState("");
  const [rows, setRows] = useState<{ food: Item | null; quantity: string; unit: FoodEntry["unit"] }[]>([
    { food: null, quantity: "", unit: "g" },
  ]);
  const [restaurant, setRestaurant] = useState<Item | null>(null);
  const [occurredAt, setOccurredAt] = useState(nowLocal);

  const last = exercise ? lastSetOf(saved, exercise.id) : undefined;

  const pickExercise = (e: Item | null) => {
    setExercise(e);
    const l = e ? lastSetOf(saved, e.id) : undefined;
    if (l) {
      // Prefill from the last Set of this Exercise: the most likely next Set.
      setBodyweight(l.weight_lb === null);
      setWeight(l.weight_lb === null ? "" : String(l.weight_lb));
      setReps(String(l.reps));
    }
  };

  const setDraft = exercise && reps
    ? { id: setId, exercise, reps: Number(reps), weight_lb: bodyweight ? null : Number(weight) || 0, occurred_at: occurredAt }
    : null;

  const foods = rows.filter((r) => r.food && Number(r.quantity) > 0) as { food: Item; quantity: string; unit: FoodEntry["unit"] }[];
  const mealDraft =
    tab === "restaurant"
      ? restaurant && { id: mealId, label, occurred_at: occurredAt, restaurant, food_entries: [] }
      : foods.length > 0 && {
          id: mealId,
          label,
          occurred_at: occurredAt,
          restaurant: null,
          food_entries: foods.map((r) => ({ food: r.food, quantity: Number(r.quantity), unit: r.unit })),
        };

  const save = () => {
    if (tab === "set" && setDraft) {
      onSave({ type: "set", set: setDraft });
      setSetId(uuidv7()); // keep exercise/weight/reps: next Set is usually the same
      setOccurredAt(nowLocal());
      flash(`Saved ${setDraft.exercise.name} ${fmtSet(setDraft.weight_lb, setDraft.reps)}`);
    } else if (tab !== "set" && mealDraft) {
      onSave({ type: "meal", meal: mealDraft });
      setMealId(uuidv7());
      setLabel("");
      setRows([{ food: null, quantity: "", unit: "g" }]);
      setRestaurant(null);
      setOccurredAt(nowLocal());
      flash("Meal saved");
    }
  };

  const canSave = tab === "set" ? !!setDraft : !!mealDraft;

  return (
    <div className="mx-auto min-h-screen max-w-md pb-40">
      <Toast text={toast} />
      <header className="sticky top-0 z-10 bg-stone-100/95 px-4 pt-4 pb-3 backdrop-blur">
        <h1 className="mb-3 text-xl font-bold">Log</h1>
        <div role="tablist" className="grid grid-cols-3 rounded-xl bg-stone-200 p-1">
          {(["set", "meal", "restaurant"] as Tab[]).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`rounded-lg py-2 capitalize ${tab === t ? "bg-white font-semibold shadow" : "text-stone-600"}`}
            >
              {t}
            </button>
          ))}
        </div>
      </header>

      <main className="flex flex-col gap-4 px-4 pb-4">
        {tab === "set" && (
          <>
            <CatalogCombo
              kind="exercise"
              label="Exercise"
              value={exercise}
              onChange={pickExercise}
              hint={last ? `Last set: ${fmtSet(last.weight_lb, last.reps)}` : undefined}
            />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Weight (lb)">
                <input
                  className={inputCls}
                  inputMode="decimal"
                  disabled={bodyweight}
                  value={bodyweight ? "" : weight}
                  placeholder={bodyweight ? "Bodyweight" : "0"}
                  onChange={(e) => setWeight(e.target.value)}
                />
              </Field>
              <Field label="Reps">
                <input className={inputCls} inputMode="numeric" value={reps} onChange={(e) => setReps(e.target.value)} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-stone-700">
              <input type="checkbox" className="h-5 w-5" checked={bodyweight} onChange={(e) => setBodyweight(e.target.checked)} />
              Bodyweight only (no external load)
            </label>
          </>
        )}

        {tab === "meal" && (
          <>
            {rows.map((r, i) => (
              <div key={i} className="flex flex-col gap-2 rounded-2xl bg-white p-3 shadow-sm">
                <CatalogCombo
                  kind="food"
                  label={`Food ${i + 1}`}
                  value={r.food}
                  onChange={(food) =>
                    setRows((rs) => rs.map((x, j) => (j === i ? { ...x, food, unit: food?.last_unit ?? x.unit } : x)))
                  }
                />
                <div className="flex items-end gap-2">
                  <Field label="Quantity">
                    <input
                      className={`${inputCls} w-28`}
                      inputMode="decimal"
                      value={r.quantity}
                      onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))}
                    />
                  </Field>
                  <UnitToggle value={r.unit} onChange={(unit) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, unit } : x)))} />
                  {rows.length > 1 && (
                    <button
                      aria-label={`Remove food ${i + 1}`}
                      onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                      className="ml-auto px-2 py-3 text-stone-400"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            ))}
            <button
              onClick={() => setRows((rs) => [...rs, { food: null, quantity: "", unit: "g" }])}
              className="rounded-xl border-2 border-dashed border-stone-300 py-3 text-stone-600"
            >
              + Add food
            </button>
          </>
        )}

        {tab === "restaurant" && <CatalogCombo kind="restaurant" label="Restaurant" value={restaurant} onChange={setRestaurant} />}

        {tab !== "set" && (
          <Field label="Label (optional)">
            <input className={inputCls} value={label} placeholder="e.g. Lunch" onChange={(e) => setLabel(e.target.value)} />
          </Field>
        )}
        <Field label="When">
          <input type="datetime-local" className={inputCls} value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
        </Field>
      </main>

      <Payload value={tab === "set" ? setDraft && setPayload(setDraft) : mealDraft && mealPayload(mealDraft)} />

      <div className="fixed inset-x-0 bottom-16 mx-auto max-w-md px-4">
        <button
          disabled={!canSave}
          onClick={save}
          className="w-full rounded-2xl bg-emerald-600 py-4 text-lg font-semibold text-white shadow-lg disabled:bg-stone-300"
        >
          Save {tab === "set" ? "Set" : "Meal"}
        </button>
      </div>
    </div>
  );
}
