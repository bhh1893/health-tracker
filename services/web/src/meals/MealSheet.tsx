import { useState, type SyntheticEvent } from "react";
import { Button, ToggleButton, ToggleButtonGroup } from "react-aria-components";

import { CatalogComboBox } from "../catalog/CatalogComboBox";
import {
  foodCatalog,
  restaurantCatalog,
  type Catalog,
  type CatalogItem,
} from "../catalog/catalogs";
import { useSuggestions } from "../catalog/queries";
import { BottomSheet } from "../components/BottomSheet";
import { fieldClass, labelClass } from "../components/formStyles";
import { ProblemAlert } from "../components/ProblemAlert";
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

const RECENT_CHIPS = 6;
const LAST_FOOD_MESSAGE =
  "A Meal keeps at least one Food. To remove it, delete the Meal.";

const kindClass =
  "flex-1 rounded-lg px-4 py-2 text-base text-gray-600 data-disabled:opacity-50 data-selected:bg-white data-selected:font-semibold data-selected:text-gray-900 data-selected:shadow-sm";

interface MealSheetProps {
  day: string;
  // The Meal to edit, or null to add a new one.
  saved: Meal | null;
  number: number;
  onClose: () => void;
}

export function MealSheet({ day, saved, number, onClose }: MealSheetProps) {
  // One id per opening, as for Sets: if a save fails after the server stored it,
  // saving again replaces that Meal instead of adding a second.
  const [id] = useState(() => saved?.id ?? uuidv7());
  const [defaultAt] = useState(() => defaultOccurredAt(day, null));
  const [draft, setDraft] = useState<MealDraft>(() =>
    saved === null ? emptyDraft(timeOfDay(defaultAt)) : draftOf(saved),
  );
  const [confirmingDelete, setConfirmingDelete] = useState(false);
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

  const name = mealName(number, saved?.label ?? null);
  const title =
    saved === null ? `Add Meal to ${formatDay(day)}` : `Edit ${name}`;

  return (
    <BottomSheet title={title} onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={save}>
        {/* A saved Meal's kind is fixed (409 kind-immutable, ADR 0006). */}
        <ToggleButtonGroup
          aria-label="Meal kind"
          className="flex gap-1 rounded-xl bg-gray-100 p-1"
          selectionMode="single"
          disallowEmptySelection
          isDisabled={saved !== null}
          selectedKeys={[draft.kind]}
          onSelectionChange={(keys) => {
            const [kind] = [...keys];
            if (kind === "foods" || kind === "restaurant") {
              change({ kind });
            }
          }}
        >
          <ToggleButton id="foods" className={kindClass}>
            Foods
          </ToggleButton>
          <ToggleButton id="restaurant" className={kindClass}>
            Restaurant
          </ToggleButton>
        </ToggleButtonGroup>

        <div className="grid grid-cols-[2fr_1fr] gap-3">
          <label className={labelClass}>
            Label
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

        {draft.kind === "foods" ? (
          <FoodsPart
            rows={draft.rows}
            lastFoodLocked={lastFoodLocked}
            onChangeRow={changeRow}
            onRemoveRow={(key) => {
              change({ rows: draft.rows.filter((row) => row.key !== key) });
            }}
            onAdd={addFood}
          />
        ) : (
          <RestaurantPart
            value={draft.restaurant}
            onChange={(restaurant) => {
              change({ restaurant });
            }}
          />
        )}

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
    </BottomSheet>
  );
}

interface FoodsPartProps {
  rows: FoodRow[];
  lastFoodLocked: boolean;
  onChangeRow: (key: string, next: Partial<FoodRow>) => void;
  onRemoveRow: (key: string) => void;
  onAdd: (food: CatalogItem) => void;
}

// The Meal's Food Entries, then the search to add one more. Picking a suggestion
// only selects it; Add commits it to the Meal (ADR 0008).
function FoodsPart({
  rows,
  lastFoodLocked,
  onChangeRow,
  onRemoveRow,
  onAdd,
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
      {rows.length === 0 ? (
        <p className="text-gray-500">No Foods yet. Search below to add one.</p>
      ) : (
        <ul aria-label="Foods" className="flex flex-col gap-3">
          {rows.map((row) => (
            <li
              key={row.key}
              aria-label={row.food.name}
              className="flex flex-col gap-2 border-b border-gray-100 pb-3"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{row.food.name}</span>
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

interface RecentChipsProps {
  catalog: Catalog;
  onPick: (item: CatalogItem) => void;
}

// The most recently used items, one tap each. An empty q is the API's "recent"
// list (ADR 0008), and the same cache entry the search shows on focus.
function RecentChips({ catalog, onPick }: RecentChipsProps) {
  const recent = useSuggestions(catalog, "", false);
  const items = (recent.data ?? []).slice(0, RECENT_CHIPS);
  if (items.length === 0) {
    return null;
  }
  return (
    <div
      role="group"
      aria-label={`Recent ${catalog.label}s`}
      className="flex gap-2 overflow-x-auto pb-1"
    >
      {items.map((item) => (
        <Button
          key={item.id}
          className="shrink-0 rounded-full border border-gray-300 px-3 py-1 text-base whitespace-nowrap data-pressed:bg-gray-100"
          onPress={() => {
            onPick(item);
          }}
        >
          {item.name}
        </Button>
      ))}
    </div>
  );
}
