import { useState, type SyntheticEvent } from "react";
import { Button } from "react-aria-components";

import { CatalogComboBox } from "../catalog/CatalogComboBox";
import {
  foodCatalog,
  restaurantCatalog,
  type CatalogItem,
} from "../catalog/catalogs";
import { RecentChips } from "../catalog/RecentChips";
import { BottomSheet } from "../components/BottomSheet";
import { fieldClass, labelClass } from "../components/formStyles";
import { ProblemAlert } from "../components/ProblemAlert";
import type { Food } from "../foods/foodForm";
import { FoodSheet } from "../foods/FoodSheet";
import { formatDay } from "../lib/day";
import { defaultOccurredAt, timeOfDay } from "../lib/occurred";
import { uuidv7 } from "../lib/uuidv7";
import {
  buildMeal,
  draftOf,
  emptyDraft,
  mealName,
  parseQuantity,
  rowFor,
  type FoodRow,
  type Meal,
  type MealDraft,
} from "./meals";
import { useDeleteMeal, usePutMeal } from "./queries";

const LAST_FOOD_MESSAGE =
  "A Meal keeps at least one Food. To remove it, delete the Meal.";

// Edit a saved Meal, or add a new one of the kind its button picked. The kind is
// fixed once the sheet opens: the Day feed has an Add button per kind, and a saved
// Meal's kind cannot change (409 kind-immutable, ADR 0006).
type MealSheetProps = {
  day: string;
  number: number;
  onClose: () => void;
} & ({ saved: Meal; kind?: never } | { saved: null; kind: Meal["kind"] });

export function MealSheet({
  day,
  saved,
  kind,
  number,
  onClose,
}: MealSheetProps) {
  // One id per opening, as for Sets: if a save fails after the server stored it,
  // saving again replaces that Meal instead of adding a second.
  const [id] = useState(() => saved?.id ?? uuidv7());
  const [defaultAt] = useState(() => defaultOccurredAt(day, null));
  const [draft, setDraft] = useState<MealDraft>(() =>
    saved === null ? emptyDraft(kind, timeOfDay(defaultAt)) : draftOf(saved),
  );
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // The Food whose sheet is open over this one (ADR 0023), or null.
  const [editingFood, setEditingFood] = useState<string | null>(null);
  const putMeal = usePutMeal();
  const deleteMeal = useDeleteMeal();

  const meal = buildMeal({ id, day, draft, saved, defaultAt });
  // Removing the last Food of a saved Meal would be refused (409 last-food-entry,
  // ADR 0006), so the sheet blocks it and says why before the user taps Save.
  const lastFoodLocked = saved !== null && draft.rows.length === 1;

  function change(next: Partial<MealDraft>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  function changeRow(key: string, next: Partial<FoodRow>) {
    setDraft((current) => ({
      ...current,
      rows: current.rows.map((row) =>
        row.key === key ? { ...row, ...next } : row,
      ),
    }));
  }

  // A renamed Food shows its new name in the rows at once. The Meal sends only Food
  // ids, so this changes what is on screen, not what Save writes.
  function foodSaved({ id: foodId, name }: Food) {
    setDraft((current) => ({
      ...current,
      rows: current.rows.map((row) =>
        row.food.id === foodId ? { ...row, food: { ...row.food, name } } : row,
      ),
    }));
  }

  function addFood(food: CatalogItem) {
    setDraft((current) => ({
      ...current,
      rows: [...current.rows, rowFor(uuidv7(), food)],
    }));
  }

  function save(event: SyntheticEvent) {
    event.preventDefault();
    if (meal === null) {
      return;
    }
    putMeal.mutate({ before: saved, after: meal }, { onSuccess: onClose });
  }

  // Last in both kinds: the pick (a Food or the Restaurant) is what a Meal is for,
  // so it leads, and the Note and Time usually keep their defaults.
  const noteAndTime = (
    <div className="grid grid-cols-[2fr_1fr] gap-3">
      <label className={labelClass}>
        Note
        <input
          type="text"
          maxLength={200}
          placeholder="Optional, e.g. Breakfast"
          className={fieldClass}
          value={draft.label}
          onChange={({ target }) => {
            change({ label: target.value });
          }}
        />
      </label>
      <label className={labelClass}>
        Time
        <input
          type="time"
          required
          // iOS draws time inputs natively, wider and taller than the CSS asks.
          // appearance-none makes it a plain box sized like the fields beside it.
          className={`${fieldClass} appearance-none`}
          value={draft.time}
          onChange={({ target }) => {
            change({ time: target.value });
          }}
        />
      </label>
    </div>
  );

  const name = mealName(number, saved?.label ?? null);
  const title =
    saved === null
      ? `Add ${kind === "foods" ? "Food" : "Restaurant"} to ${formatDay(day)}`
      : `Edit ${name}`;

  return (
    // Capped at two thirds of the screen: past that the Foods list scrolls on its
    // own, so the pick, Note and Save stay put. min-h-0 lets the form, and so the
    // list, shrink to the cap.
    <BottomSheet
      title={title}
      onClose={onClose}
      maxHeight="two-thirds"
      // Closes without saving, like Cancel, and reachable without scrolling to it.
      actions={
        <Button
          aria-label="Close"
          className="-m-2 rounded-lg p-2 text-gray-500 data-pressed:bg-gray-100"
          onPress={onClose}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-6"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
          >
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </Button>
      }
    >
      <form className="flex min-h-0 flex-col gap-4" onSubmit={save}>
        {draft.kind === "foods" ? (
          <FoodsPart
            rows={draft.rows}
            lastFoodLocked={lastFoodLocked}
            onChangeRow={changeRow}
            onRemoveRow={(key) => {
              change({ rows: draft.rows.filter((row) => row.key !== key) });
            }}
            onAdd={addFood}
            onEditFood={setEditingFood}
          />
        ) : (
          <RestaurantPart
            value={draft.restaurant}
            onChange={(restaurant) => {
              change({ restaurant });
            }}
          />
        )}
        {noteAndTime}

        {putMeal.error && <ProblemAlert error={putMeal.error} />}
        {deleteMeal.error && <ProblemAlert error={deleteMeal.error} />}

        <div className="sticky bottom-0 flex flex-col gap-3 bg-white py-2">
          {confirmingDelete && saved !== null ? (
            <div className="grid grid-cols-2 gap-3">
              <Button
                className="rounded-xl p-3 text-base text-gray-600"
                onPress={() => {
                  setConfirmingDelete(false);
                }}
              >
                Keep
              </Button>
              <Button
                className="rounded-xl bg-red-700 p-3 text-base font-semibold text-white"
                onPress={() => {
                  deleteMeal.mutate(saved, { onSuccess: onClose });
                }}
              >
                Delete {name}
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {saved === null ? (
                <Button
                  className="rounded-xl p-3 text-base text-gray-600"
                  onPress={onClose}
                >
                  Cancel
                </Button>
              ) : (
                <Button
                  className="rounded-xl p-3 text-base text-red-700"
                  onPress={() => {
                    setConfirmingDelete(true);
                  }}
                >
                  Delete Meal
                </Button>
              )}
              <Button
                type="submit"
                className="rounded-xl bg-teal-700 p-3 text-base font-semibold text-white data-disabled:bg-gray-300"
                isDisabled={meal === null || putMeal.isPending}
              >
                Save
              </Button>
            </div>
          )}
        </div>
      </form>

      {/* Outside the form on purpose. The Food sheet is a portal, so the DOM keeps
          its form apart, but React bubbles events along the component tree: inside,
          its submit would also submit this Meal. */}
      {editingFood && (
        <FoodSheet
          foodId={editingFood}
          onClose={() => {
            setEditingFood(null);
          }}
          onSaved={foodSaved}
        />
      )}
    </BottomSheet>
  );
}

interface FoodsPartProps {
  rows: FoodRow[];
  lastFoodLocked: boolean;
  onChangeRow: (key: string, next: Partial<FoodRow>) => void;
  onRemoveRow: (key: string) => void;
  onAdd: (food: CatalogItem) => void;
  onEditFood: (foodId: string) => void;
}

// The search to add a Food, then the Meal's Food Entries in a bordered list that
// scrolls on its own. Picking a suggestion only selects it; Add commits it to the
// Meal (ADR 0008).
function FoodsPart({
  rows,
  lastFoodLocked,
  onChangeRow,
  onRemoveRow,
  onAdd,
  onEditFood,
}: FoodsPartProps) {
  const [picked, setPicked] = useState<CatalogItem | null>(null);
  // Remounts the search after each Add, so it starts empty for the next Food.
  const [searchKey, setSearchKey] = useState(0);

  function add(food: CatalogItem) {
    onAdd(food);
    setPicked(null);
    setSearchKey((current) => current + 1);
  }

  return (
    <>
      <div className="grid grid-cols-[2fr_1fr] items-end gap-3">
        <CatalogComboBox
          key={searchKey}
          catalog={foodCatalog}
          label="Add Food"
          value={picked}
          onChange={setPicked}
        />
        <Button
          className="rounded-xl bg-teal-700 p-3 text-base font-semibold text-white data-disabled:bg-gray-300"
          isDisabled={picked === null}
          onPress={() => {
            if (picked) {
              add(picked);
            }
          }}
        >
          Add
        </Button>
      </div>
      <RecentChips catalog={foodCatalog} onPick={add} />
      {rows.length === 0 ? (
        <p className="text-gray-500">No Foods yet. Search above to add one.</p>
      ) : (
        // min-h-28 keeps about one row in view when the sheet is at its cap.
        <ul
          aria-label="Foods"
          className="min-h-28 divide-y divide-gray-300 overflow-y-auto overscroll-contain rounded-xl border border-gray-300"
        >
          {rows.map((row) => (
            <li
              key={row.key}
              aria-label={row.food.name}
              className="flex flex-col gap-2 px-3 py-3"
            >
              <div className="flex items-center justify-between">
                <Button
                  aria-label={`Edit Food ${row.food.name}`}
                  className="rounded-lg py-2 text-left font-medium underline decoration-gray-300 underline-offset-4 data-pressed:bg-gray-100"
                  onPress={() => {
                    onEditFood(row.food.id);
                  }}
                >
                  {row.food.name}
                </Button>
                <Button
                  aria-label={`Remove ${row.food.name}`}
                  className="rounded-lg p-2 text-base text-teal-700 data-disabled:text-gray-300"
                  isDisabled={lastFoodLocked}
                  onPress={() => {
                    onRemoveRow(row.key);
                  }}
                >
                  Remove
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className={labelClass}>
                  Quantity
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    required
                    aria-invalid={parseQuantity(row.quantity) === null}
                    className={fieldClass}
                    value={row.quantity}
                    onChange={({ target }) => {
                      onChangeRow(row.key, { quantity: target.value });
                    }}
                  />
                </label>
                <label className={labelClass}>
                  Unit
                  <select
                    className={fieldClass}
                    value={row.unit}
                    onChange={({ target }) => {
                      onChangeRow(row.key, {
                        unit: target.value === "count" ? "count" : "g",
                      });
                    }}
                  >
                    <option value="g">g</option>
                    <option value="count">count</option>
                  </select>
                </label>
              </div>
            </li>
          ))}
        </ul>
      )}
      {lastFoodLocked && (
        <p className="text-sm text-gray-600">{LAST_FOOD_MESSAGE}</p>
      )}
    </>
  );
}

interface RestaurantPartProps {
  value: CatalogItem | null;
  onChange: (restaurant: CatalogItem | null) => void;
}

function RestaurantPart({ value, onChange }: RestaurantPartProps) {
  // A chip sets the value from outside the search box, which keeps its own text, so
  // remount it to show the chip's name.
  const [searchKey, setSearchKey] = useState(0);
  return (
    <>
      <CatalogComboBox
        key={searchKey}
        catalog={restaurantCatalog}
        value={value}
        onChange={onChange}
      />
      <RecentChips
        catalog={restaurantCatalog}
        onPick={(restaurant) => {
          onChange(restaurant);
          setSearchKey((current) => current + 1);
        }}
      />
    </>
  );
}
