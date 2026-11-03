// PROTOTYPE, throwaway (issue #14).
// Variant B, "Step by step": one decision per screen, big tap targets and +/- steppers
// instead of keyboards. After a Set, "Same again" logs the next one in one tap.
import { useState, type ReactNode } from "react";
import type { VariantProps } from "./App";
import { CatalogCombo } from "./CatalogCombo";
import { Field, Payload, Stepper, Toast, UnitToggle, fmtSet, inputCls } from "./Shared";
import {
  lastSetOf,
  mealPayload,
  nowLocal,
  setPayload,
  uuidv7,
  type FoodEntry,
  type Item,
  type MealDraft,
  type SetDraft,
  type Unit,
} from "./stub";

type Screen =
  | "home"
  | "set-exercise"
  | "set-weight"
  | "set-reps"
  | "set-done"
  | "food-pick"
  | "food-qty"
  | "meal-list"
  | "rest-pick"
  | "meal-finish";

export function VariantB({ saved, onSave }: VariantProps) {
  const [screen, setScreen] = useState<Screen>("home");
  const [history, setHistory] = useState<Screen[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const go = (s: Screen) => {
    setHistory((h) => [...h, screen]);
    setScreen(s);
  };
  const back = () => {
    setScreen(history[history.length - 1] ?? "home");
    setHistory((h) => h.slice(0, -1));
  };
  const reset = () => {
    setHistory([]);
    setScreen("home");
  };
  const flash = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(null), 1500);
  };

  // Set
  const [exercise, setExercise] = useState<Item | null>(null);
  const [weight, setWeight] = useState(45);
  const [bodyweight, setBodyweight] = useState(false);
  const [reps, setReps] = useState(5);
  const [lastSaved, setLastSaved] = useState<SetDraft | null>(null);

  // Meal
  const [meal, setMeal] = useState<MealDraft>(() => newMeal());
  const [food, setFood] = useState<Item | null>(null);
  const [qty, setQty] = useState(100);
  const [unit, setUnit] = useState<Unit>("g");

  const saveSet = (draft: SetDraft) => {
    onSave({ type: "set", set: draft });
    setLastSaved(draft);
    flash(`Saved ${draft.exercise.name} ${fmtSet(draft.weight_lb, draft.reps)}`);
  };

  const setDraft: SetDraft | null = exercise && {
    id: uuidv7(),
    exercise,
    reps,
    weight_lb: bodyweight ? null : weight,
    occurred_at: nowLocal(),
  };

  let body: ReactNode;
  let payload: unknown = null;

  switch (screen) {
    case "home":
      body = (
        <div className="flex flex-1 flex-col justify-center gap-4">
          <BigButton onPress={() => go("set-exercise")}>🏋️ Log a Set</BigButton>
          <BigButton onPress={() => (setMeal(newMeal()), go("food-pick"))}>🍳 Log a Meal</BigButton>
          <BigButton onPress={() => (setMeal(newMeal()), go("rest-pick"))}>🍽️ Log a Restaurant Meal</BigButton>
        </div>
      );
      break;

    case "set-exercise":
      body = (
        <Step title="Which exercise?">
          <CatalogCombo
            big
            autoFocus
            kind="exercise"
            label="Exercise"
            value={exercise}
            onChange={(e) => {
              setExercise(e);
              if (!e) return;
              const l = lastSetOf(saved, e.id);
              if (l) {
                setBodyweight(l.weight_lb === null);
                setWeight(l.weight_lb ?? 45);
                setReps(l.reps);
              }
              go("set-weight");
            }}
          />
        </Step>
      );
      break;

    case "set-weight": {
      const l = exercise && lastSetOf(saved, exercise.id);
      body = (
        <Step title={exercise?.name ?? ""} subtitle={l ? `Last set: ${fmtSet(l.weight_lb, l.reps)}` : "First time logging this"}>
          {bodyweight ? (
            <p className="text-center text-4xl font-semibold">Bodyweight</p>
          ) : (
            <Stepper label="Weight" value={weight} step={5} onChange={setWeight} suffix="lb" />
          )}
          <button onClick={() => setBodyweight((b) => !b)} className="mx-auto text-stone-600 underline">
            {bodyweight ? "Add external load" : "Bodyweight only"}
          </button>
          <NextButton onPress={() => go("set-reps")}>Next</NextButton>
        </Step>
      );
      break;
    }

    case "set-reps":
      payload = setDraft && setPayload(setDraft);
      body = (
        <Step title={exercise?.name ?? ""} subtitle={bodyweight ? "Bodyweight" : `${weight} lb`}>
          <Stepper label="Reps" value={reps} step={1} onChange={setReps} />
          <NextButton onPress={() => setDraft && (saveSet(setDraft), go("set-done"))}>Save Set</NextButton>
        </Step>
      );
      break;

    case "set-done":
      body = (
        <Step title="Set saved" subtitle={lastSaved ? `${lastSaved.exercise.name} ${fmtSet(lastSaved.weight_lb, lastSaved.reps)}` : ""}>
          <BigButton onPress={() => lastSaved && saveSet({ ...lastSaved, id: uuidv7(), occurred_at: nowLocal() })}>
            Same again
          </BigButton>
          <SecondaryButton onPress={() => setScreen("set-weight")}>Change weight or reps</SecondaryButton>
          <SecondaryButton onPress={() => (setExercise(null), setScreen("set-exercise"))}>Different exercise</SecondaryButton>
          <SecondaryButton onPress={reset}>Done</SecondaryButton>
        </Step>
      );
      break;

    case "food-pick":
      body = (
        <Step title="What did you eat?" subtitle={meal.food_entries.length ? `${meal.food_entries.length} food(s) so far` : undefined}>
          <CatalogCombo
            big
            autoFocus
            kind="food"
            label="Food"
            value={food}
            onChange={(f) => {
              setFood(f);
              if (!f) return;
              const u = f.last_unit ?? "g";
              setUnit(u);
              setQty(u === "g" ? 100 : 1);
              go("food-qty");
            }}
          />
        </Step>
      );
      break;

    case "food-qty":
      body = (
        <Step title={food?.name ?? ""}>
          <Stepper label="Quantity" value={qty} step={unit === "g" ? 10 : 1} onChange={setQty} suffix={unit} />
          <div className="mx-auto">
            <UnitToggle value={unit} onChange={setUnit} />
          </div>
          <NextButton
            onPress={() => {
              if (!food) return;
              const entry: FoodEntry = { food, quantity: qty, unit };
              setMeal((m) => ({ ...m, food_entries: [...m.food_entries, entry] }));
              setFood(null);
              go("meal-list");
            }}
          >
            Add to Meal
          </NextButton>
        </Step>
      );
      break;

    case "meal-list":
      payload = mealPayload(meal);
      body = (
        <Step title="This Meal">
          <ul className="flex flex-col divide-y divide-stone-200 rounded-2xl bg-white">
            {meal.food_entries.map((f, i) => (
              <li key={i} className="flex items-center justify-between px-4 py-3">
                <span>{f.food.name}</span>
                <span className="flex items-center gap-3 text-stone-600">
                  {f.quantity} {f.unit}
                  <button
                    aria-label={`Remove ${f.food.name}`}
                    onClick={() => setMeal((m) => ({ ...m, food_entries: m.food_entries.filter((_, j) => j !== i) }))}
                    className="text-stone-400"
                  >
                    ✕
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <SecondaryButton onPress={() => go("food-pick")}>+ Add another food</SecondaryButton>
          <NextButton onPress={() => meal.food_entries.length && go("meal-finish")}>Finish Meal</NextButton>
        </Step>
      );
      break;

    case "rest-pick":
      body = (
        <Step title="Which restaurant?">
          <CatalogCombo
            big
            autoFocus
            kind="restaurant"
            label="Restaurant"
            value={meal.restaurant}
            onChange={(r) => {
              setMeal((m) => ({ ...m, restaurant: r }));
              if (r) go("meal-finish");
            }}
          />
        </Step>
      );
      break;

    case "meal-finish":
      payload = mealPayload(meal);
      body = (
        <Step title="When and what to call it?">
          <Field label="When">
            <input
              type="datetime-local"
              className={`${inputCls} text-xl`}
              value={meal.occurred_at}
              onChange={(e) => setMeal((m) => ({ ...m, occurred_at: e.target.value }))}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            {["Breakfast", "Lunch", "Dinner", "Snack"].map((l) => (
              <button
                key={l}
                onClick={() => setMeal((m) => ({ ...m, label: m.label === l ? "" : l }))}
                className={`rounded-full px-4 py-2 ${meal.label === l ? "bg-stone-900 text-white" : "bg-white"}`}
              >
                {l}
              </button>
            ))}
          </div>
          <NextButton
            onPress={() => {
              onSave({ type: "meal", meal });
              flash("Meal saved");
              reset();
            }}
          >
            Save Meal
          </NextButton>
        </Step>
      );
      break;
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col">
      <Toast text={toast} />
      <header className="flex items-center gap-2 px-4 pt-4">
        {screen !== "home" && (
          <button onClick={back} className="rounded-full px-3 py-2 text-stone-600" aria-label="Back">
            ← Back
          </button>
        )}
      </header>
      <main className="flex flex-1 flex-col px-4 pb-6">{body}</main>
      {payload !== null && <Payload value={payload} />}
      <div className="h-16" />
    </div>
  );
}

function newMeal(): MealDraft {
  return { id: uuidv7(), label: "", occurred_at: nowLocal(), food_entries: [], restaurant: null };
}

function Step(props: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col gap-6 pt-4">
      <div>
        <h1 className="text-3xl font-bold">{props.title}</h1>
        {props.subtitle && <p className="mt-1 text-stone-500">{props.subtitle}</p>}
      </div>
      {props.children}
    </div>
  );
}

function BigButton(props: { onPress: () => void; children: ReactNode }) {
  return (
    <button onClick={props.onPress} className="rounded-3xl bg-emerald-600 px-6 py-6 text-2xl font-semibold text-white shadow active:bg-emerald-700">
      {props.children}
    </button>
  );
}

function NextButton(props: { onPress: () => void; children: ReactNode }) {
  return (
    <button onClick={props.onPress} className="mt-auto rounded-2xl bg-stone-900 py-4 text-lg font-semibold text-white active:bg-stone-700">
      {props.children}
    </button>
  );
}

function SecondaryButton(props: { onPress: () => void; children: ReactNode }) {
  return (
    <button onClick={props.onPress} className="rounded-2xl border border-stone-300 bg-white py-4 text-lg active:bg-stone-100">
      {props.children}
    </button>
  );
}
