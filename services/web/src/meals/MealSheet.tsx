import { useState, type ReactNode, type SyntheticEvent } from "react";
import { Button } from "react-aria-components";

import { CatalogComboBox } from "../catalog/CatalogComboBox";
import {
  foodCatalog,
  restaurantCatalog,
  type CatalogItem,
  type CatalogRef,
} from "../catalog/catalogs";
import { RecentChips } from "../catalog/RecentChips";
import { Sheet } from "../components/Sheet";
import { ForkKnifeIcon } from "../components/ForkKnifeIcon";
import { fieldClass, labelClass } from "../components/formStyles";
import { ProblemAlert } from "../components/ProblemAlert";
import { formatDay } from "../lib/day";
import { defaultOccurredAt } from "../lib/occurred";
import { uuidv7 } from "../lib/uuidv7";
import {
  buildMeal,
  draftOf,
  emptyDraft,
  LABEL_PRESETS,
  MAX_RESTAURANTS,
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
// The select's value for "type my own"; no real Label can collide with it, since
// a typed Label never reaches the select's value.
const OTHER = "__other__";
const FULL_MESSAGE = `A Meal holds at most ${String(MAX_RESTAURANTS)} Restaurants. Remove one to add another.`;

// Edit a saved Meal, or add a new one of the kind its button picked. The kind is
// fixed once the sheet opens: the Day feed has an Add button per kind, and a saved
// Meal's kind cannot change (409 kind-immutable, ADR 0006).
type MealSheetProps = {
  day: string;
  onClose: () => void;
} & ({ saved: Meal; kind?: never } | { saved: null; kind: Meal["kind"] });

export function MealSheet({ day, saved, kind, onClose }: MealSheetProps) {
  // One id per opening, as for Sets: if a save fails after the server stored it,
  // saving again replaces that Meal instead of adding a second.
  const [id] = useState(() => saved?.id ?? uuidv7());
  const [defaultAt] = useState(() => defaultOccurredAt(day, null));
  const [draft, setDraft] = useState<MealDraft>(() =>
    saved === null ? emptyDraft(kind) : draftOf(saved),
  );
  // Typing a Label instead of picking a preset. Its own state, because "Other" with
  // nothing typed yet and no Label both hold an empty label.
  const [customLabel, setCustomLabel] = useState(
    () => draft.label !== "" && !LABEL_PRESETS.includes(draft.label),
  );
  const [pickedOther, setPickedOther] = useState(false);
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

  function addRestaurant({ id, name, archived }: CatalogItem) {
    setDraft((current) => ({
      ...current,
      restaurants: [...current.restaurants, { id, name, archived }],
    }));
  }

  function save(event: SyntheticEvent) {
    event.preventDefault();
    if (meal === null) {
      return;
    }
    putMeal.mutate({ before: saved, after: meal }, { onSuccess: onClose });
  }

  // Last in both kinds: the picks (Foods or Restaurants) are what a Meal is for,
  // so they lead, and the Label is optional. No time field: a new Meal happens now
  // and an edit keeps its time (ADR 0008). A native select, so on a phone picking a
  // preset opens the system picker, not the keyboard; Other adds a text field.
  const labelField = (
    <div className="flex flex-col gap-2">
      <label className={labelClass}>
        Label
        <select
          className={fieldClass}
          value={customLabel ? OTHER : draft.label}
          onChange={({ target }) => {
            const other = target.value === OTHER;
            setCustomLabel(other);
            setPickedOther(other);
            change({ label: other ? "" : target.value });
          }}
        >
          <option value="">None</option>
          {LABEL_PRESETS.map((preset) => (
            <option key={preset}>{preset}</option>
          ))}
          <option value={OTHER}>Other...</option>
        </select>
      </label>
      {customLabel && (
        <input
          type="text"
          aria-label="Other Label"
          maxLength={200}
          placeholder="e.g. Brunch"
          // Focus only when the user just picked Other, not when an edit opens on a
          // typed Label: the keyboard opens when asked for.
          autoFocus={pickedOther}
          className={fieldClass}
          value={draft.label}
          onChange={({ target }) => {
            change({ label: target.value });
          }}
        />
      )}
    </div>
  );

  const name = mealName(saved?.label ?? null);
  const title =
    saved === null
      ? `Add ${kind === "foods" ? "Food" : "Restaurant"} to ${formatDay(day)}`
      : `Edit ${name}`;

  return (
    // A fixed two thirds of the screen, so the sheet keeps its size as Foods are
    // added. The form fills it (flex-1), and the Foods or Restaurants box takes the
    // spare height and scrolls on its own, so the pick, Label and Save stay put.
    // min-h-0 lets the form, and so the box, shrink when the keyboard opens.
    <Sheet
      title={title}
      onClose={onClose}
      size="two-thirds"
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
      <form className="flex min-h-0 flex-1 flex-col gap-4" onSubmit={save}>
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
            restaurants={draft.restaurants}
            onAdd={addRestaurant}
            onRemove={(restaurantId) => {
              change({
                restaurants: draft.restaurants.filter(
                  ({ id }) => id !== restaurantId,
                ),
              });
            }}
          />
        )}
        {labelField}

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
    </Sheet>
  );
}

interface FoodsPartProps {
  rows: FoodRow[];
  lastFoodLocked: boolean;
  onChangeRow: (key: string, next: Partial<FoodRow>) => void;
  onRemoveRow: (key: string) => void;
  onAdd: (food: CatalogItem) => void;
}

// The search to add a Food, then the Meal's Food Entries in a bordered list that
// scrolls on its own. Picking a suggestion only selects it; Add commits it to the
// Meal (ADR 0008). A Food's name is plain text: Nutrition is edited only on Profile,
// so logging never stops for a label (ADR 0032).
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
      {/* min-h-28 keeps about one row in view when the keyboard shrinks the sheet. */}
      <EntryBox className="min-h-28">
        {rows.length === 0 ? (
          <p className="p-3 text-gray-500">
            No Foods yet. Search above to add one.
          </p>
        ) : (
          <ul aria-label="Foods" className="divide-y divide-gray-300">
            {rows.map((row) => (
              <li
                key={row.key}
                aria-label={row.food.name}
                className="flex flex-col gap-2 px-3 py-3"
              >
                <div className="flex items-center justify-between">
                  <span className="py-2 font-medium">{row.food.name}</span>
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
      </EntryBox>
      {lastFoodLocked && (
        <p className="text-sm text-gray-600">{LAST_FOOD_MESSAGE}</p>
      )}
    </>
  );
}

interface RestaurantPartProps {
  restaurants: CatalogRef[];
  onAdd: (restaurant: CatalogItem) => void;
  onRemove: (id: string) => void;
}

// Like FoodsPart: the search and recent chips add to the Meal's ordered list of
// Restaurants, each removable (ADR 0034). A Restaurant appears once per Meal and a
// Meal holds at most ten, so the sheet disables what the API would refuse.
function RestaurantPart({ restaurants, onAdd, onRemove }: RestaurantPartProps) {
  const [picked, setPicked] = useState<CatalogItem | null>(null);
  // Remounts the search after each Add, so it starts empty for the next one.
  const [searchKey, setSearchKey] = useState(0);
  const full = restaurants.length >= MAX_RESTAURANTS;
  const canAdd = (restaurant: CatalogItem) =>
    !full && !restaurants.some(({ id }) => id === restaurant.id);

  function add(restaurant: CatalogItem) {
    onAdd(restaurant);
    setPicked(null);
    setSearchKey((current) => current + 1);
  }

  return (
    <>
      <div className="grid grid-cols-[2fr_1fr] items-end gap-3">
        <CatalogComboBox
          key={searchKey}
          catalog={restaurantCatalog}
          label="Add Restaurant"
          value={picked}
          onChange={setPicked}
        />
        <Button
          className="rounded-xl bg-teal-700 p-3 text-base font-semibold text-white data-disabled:bg-gray-300"
          isDisabled={picked === null || !canAdd(picked)}
          onPress={() => {
            if (picked) {
              add(picked);
            }
          }}
        >
          Add
        </Button>
      </div>
      <RecentChips
        catalog={restaurantCatalog}
        onPick={add}
        isDisabled={(restaurant) => !canAdd(restaurant)}
      />
      <EntryBox className="min-h-14">
        {restaurants.length === 0 ? (
          <p className="p-3 text-gray-500">
            No Restaurants yet. Search above to add one.
          </p>
        ) : (
          <ul aria-label="Restaurants" className="divide-y divide-gray-300">
            {restaurants.map((restaurant) => (
              <li
                key={restaurant.id}
                aria-label={restaurant.name}
                className="flex items-center justify-between px-3 py-1"
              >
                <span className="flex items-center gap-2 py-2 font-medium text-orange-800">
                  <ForkKnifeIcon />
                  {restaurant.name}
                </span>
                <Button
                  aria-label={`Remove ${restaurant.name}`}
                  className="rounded-lg p-2 text-base text-teal-700"
                  onPress={() => {
                    onRemove(restaurant.id);
                  }}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </EntryBox>
      {full && <p className="text-sm text-gray-600">{FULL_MESSAGE}</p>}
    </>
  );
}

// The bordered box that holds a Meal's Foods or Restaurants, shown even while empty.
// flex-1 takes the sheet's spare height, so the box is the part that changes as rows
// are added, never the sheet; past its height it scrolls on its own.
// overscroll-contain stops a scroll that hits its end from scrolling the feed behind.
function EntryBox({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`${className} flex-1 overflow-y-auto overscroll-contain rounded-xl border border-gray-300`}
    >
      {children}
    </div>
  );
}
