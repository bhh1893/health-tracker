import { useId, useState, type SyntheticEvent } from "react";
import {
  Button,
  ButtonContext,
  ComboBox,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  type Key,
} from "react-aria-components";

import {
  foodCatalog,
  MAX_NAME_LENGTH,
  type CatalogRef,
} from "../catalog/catalogs";
import { ItemActions } from "../catalog/ItemActions";
import { NameClash } from "../catalog/NameClash";
import { nameClashOf } from "../catalog/nameClash";
import { Sheet } from "../components/Sheet";
import { ClearIcon } from "../components/ClearIcon";
import { NumberField, TextField } from "../components/Fields";
import { ProblemAlert } from "../components/ProblemAlert";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { uuidv7 } from "../lib/uuidv7";
import {
  checkFood,
  draftOf,
  EMPTY_FOOD_DRAFT,
  fillFrom,
  NUTRITION_FIELDS,
  type Food,
  type FoodDraft,
  type FoodErrors,
  type NutritionField,
  type ReferenceFood,
} from "./foodForm";
import {
  useFood,
  usePatchFood,
  usePutFood,
  useReferenceFoods,
} from "./queries";

const DEBOUNCE_MS = 150;

const NUTRITION_LABELS: Record<NutritionField, string> = {
  basis_g: "Basis (g)",
  kcal: "Calories (kcal)",
  protein_g: "Protein (g)",
  carbs_g: "Carbs (g)",
  fat_g: "Fat (g)",
};

interface FoodSheetProps {
  // null opens an empty sheet whose Save creates the Food (a Profile Catalog page's Add button).
  foodId: string | null;
  onClose: () => void;
  // Profile's sheet (ADR 0032) adds Archive, Unarchive and Delete.
  manage?: boolean | undefined;
  // Opens a Food whose name clashes, in place of this one.
  onOpen?: (food: CatalogRef) => void;
}

// ADR 0023's Food sheet: a Food's name, Nutrition and Piece Weight, saved as one
// write, opened only from Profile's Foods page (ADR 0032). An existing Food is read
// first, so the form starts from the server's current values.
export function FoodSheet({ foodId, manage, ...form }: FoodSheetProps) {
  if (foodId === null) {
    // Nothing to archive or delete before the Food exists.
    return (
      <Sheet title="New Food" onClose={form.onClose}>
        <FoodForm food={null} {...form} />
      </Sheet>
    );
  }
  return <SavedFoodSheet foodId={foodId} manage={manage} {...form} />;
}

function SavedFoodSheet({
  foodId,
  manage,
  ...form
}: FoodSheetProps & { foodId: string }) {
  const food = useFood(foodId);
  return (
    <Sheet
      title={food.data?.name ?? "Food"}
      onClose={form.onClose}
      actions={
        manage &&
        food.data && (
          <ItemActions
            catalog={foodCatalog}
            item={food.data}
            onDone={form.onClose}
          />
        )
      }
    >
      {food.data ? (
        <FoodForm food={food.data} {...form} />
      ) : food.error ? (
        <ProblemAlert error={food.error} />
      ) : (
        <p role="status" className="text-gray-500">
          Loading...
        </p>
      )}
    </Sheet>
  );
}

type FoodFormProps = Omit<FoodSheetProps, "foodId" | "manage"> & {
  food: Food | null;
};

// Mounted only once the Food has loaded, so the draft starts from the server's
// values without an effect copying them in.
function FoodForm({ food, onClose, onOpen }: FoodFormProps) {
  const [draft, setDraft] = useState<FoodDraft>(() =>
    food ? draftOf(food) : EMPTY_FOOD_DRAFT,
  );
  const [filledFrom, setFilledFrom] = useState<string | null>(null);
  // Remounts the search after each pick, so it starts closed and empty, as the Meal
  // sheet's Add search does.
  const [searchKey, setSearchKey] = useState(0);
  // Errors show from the first Save on, not while the user is still typing the
  // first of five fields.
  const [triedSave, setTriedSave] = useState(false);
  // Made once per sheet, so "Save anyway" after a clash writes the same new Food.
  const [newId] = useState(uuidv7);
  const id = food?.id ?? newId;
  const patchFood = usePatchFood(id);
  const putFood = usePutFood(id);
  const write = food ? patchFood : putFood;

  const nutritionId = useId();
  const check = checkFood(draft);
  const errors: FoodErrors = triedSave && !check.ok ? check.errors : {};
  const clash = nameClashOf(write.error);

  function change(next: Partial<FoodDraft>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  function send(allowSimilar: boolean) {
    setTriedSave(true);
    if (!check.ok) {
      return;
    }
    const body = { ...check.body, allow_similar: allowSimilar };
    const done = { onSuccess: onClose };
    if (food) {
      patchFood.mutate(body, done);
    } else {
      putFood.mutate(body, done);
    }
  }

  function nutritionField(field: NutritionField) {
    return (
      <NumberField
        label={NUTRITION_LABELS[field]}
        value={draft[field]}
        error={errors[field]}
        onChange={(value) => {
          change({ [field]: value });
        }}
      />
    );
  }

  function save(event: SyntheticEvent) {
    event.preventDefault();
    send(false);
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={save} noValidate>
      {/* items-start: an error under one field must not stretch the other. */}
      <div className="grid grid-cols-2 items-start gap-3">
        <TextField
          label="Name"
          value={draft.name}
          error={errors.name}
          maxLength={MAX_NAME_LENGTH}
          onChange={(name) => {
            change({ name });
            // A clash was about the name as sent. Once it changes, "Save anyway"
            // would vouch for a name the server never checked.
            write.reset();
          }}
        />
        <ReferenceSearch
          key={searchKey}
          onPick={(reference) => {
            setDraft((current) => fillFrom(current, reference));
            setFilledFrom(reference.name);
            setSearchKey((current) => current + 1);
          }}
        />
      </div>
      {filledFrom && (
        <p role="status" className="text-sm text-gray-600">
          Filled from {filledFrom}. Check it against your label.
        </p>
      )}

      {/* Named by its visible header, not a <legend>: a legend cannot share a
          row with the Clear button. Piece Weight sits in the grid beside Basis,
          both being grams, though Clear leaves it alone. */}
      <fieldset aria-labelledby={nutritionId} className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span id={nutritionId} className="font-medium">
            Nutrition, as on the label
          </span>
          <Button
            aria-label="Clear Nutrition"
            className="rounded-xl px-3 py-1 text-base text-teal-700"
            onPress={() => {
              change(Object.fromEntries(NUTRITION_FIELDS.map((f) => [f, ""])));
            }}
          >
            Clear
          </Button>
        </div>
        <div className="grid grid-cols-2 items-start gap-3">
          {nutritionField("basis_g")}
          <NumberField
            label="Piece Weight (g)"
            hint="Grams in one piece, to total a count."
            value={draft.piece_g}
            error={errors.piece_g}
            onChange={(piece_g) => {
              change({ piece_g });
            }}
          />
          {nutritionField("kcal")}
          {nutritionField("protein_g")}
          {nutritionField("carbs_g")}
          {nutritionField("fat_g")}
        </div>
        {errors.nutrition && (
          <p role="alert" className="text-sm text-red-800">
            {errors.nutrition}
          </p>
        )}
      </fieldset>

      {clash ? (
        <NameClash
          clash={clash}
          name={draft.name.trim()}
          pending={write.isPending}
          onSaveAnyway={() => {
            send(true);
          }}
          onOpen={onOpen}
        />
      ) : (
        write.error && <ProblemAlert error={write.error} />
      )}

      <div className="sticky bottom-0 grid grid-cols-2 gap-3 bg-white py-2">
        <Button
          className="rounded-xl p-3 text-base text-gray-600"
          onPress={onClose}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          className="rounded-xl bg-teal-700 p-3 text-base font-semibold text-white data-disabled:bg-gray-300"
          isDisabled={write.isPending}
        >
          Save
        </Button>
      </div>
    </form>
  );
}

interface ReferenceSearchProps {
  onPick: (reference: ReferenceFood) => void;
}

// "Fill from reference": a typeahead whose pick is an action, not a value. Picking
// copies the values into the form (ADR 0023, copy-on-pick), and the parent remounts
// this to empty it.
// Not CatalogComboBox: that one creates, unarchives and holds a picked item, none of
// which applies to a read-only list the owner curates.
function ReferenceSearch({ onPick }: ReferenceSearchProps) {
  const [text, setText] = useState("");
  const q = useDebouncedValue(text.trim(), DEBOUNCE_MS);
  const references = useReferenceFoods(q);
  const items = references.data ?? [];

  function select(key: Key | null) {
    const reference = items.find(({ id }) => id === key);
    if (reference) {
      onPick(reference);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <ComboBox
        className="flex min-w-0 flex-col gap-1"
        inputValue={text}
        items={items}
        // Never holds a pick: picking fills the form instead.
        value={null}
        allowsEmptyCollection
        menuTrigger="input"
        onInputChange={setText}
        onChange={select}
      >
        <Label className="text-sm font-medium text-gray-600">
          Fill from reference
        </Label>
        <div className="flex rounded-xl border border-gray-300 bg-white focus-within:ring-2 focus-within:ring-teal-600">
          <Input
            className="w-full min-w-0 rounded-xl bg-transparent p-3 text-base outline-none"
            placeholder="Search"
          />
          {text !== "" && (
            // Null ButtonContext: clear the text instead of toggling the menu.
            <ButtonContext.Provider value={null}>
              <Button
                aria-label="Clear"
                className="flex size-11 shrink-0 items-center justify-center text-gray-500"
                onPress={() => {
                  setText("");
                }}
              >
                <ClearIcon />
              </Button>
            </ButtonContext.Provider>
          )}
        </div>
        {/* Hidden while a search with nothing to show yet runs: no "Searching..."
            flash on every keystroke. */}
        <Popover
          // Always below the box. By default the menu flips above when there
          // is less room below than it wants, so it jumped sides as the rows
          // changed. Pinned, it shrinks to the room below and scrolls instead.
          placement="bottom"
          shouldFlip={false}
          className={
            items.length === 0 && references.isFetching
              ? "hidden"
              : "w-(--trigger-width) overflow-auto rounded-xl border border-gray-200 bg-white shadow-lg"
          }
        >
          <ListBox<ReferenceFood>
            className="max-h-72 outline-none"
            renderEmptyState={() => (
              <p className="p-3 text-base text-gray-500">No match</p>
            )}
          >
            {(reference) => (
              <ListBoxItem
                id={reference.id}
                textValue={reference.name}
                className="cursor-pointer p-3 text-base outline-none data-focused:bg-teal-50"
              >
                <span className="block">{reference.name}</span>
                <span className="block text-sm text-gray-500">
                  {String(reference.nutrition.kcal)} cal per{" "}
                  {String(reference.nutrition.basis_g)} g
                </span>
              </ListBoxItem>
            )}
          </ListBox>
        </Popover>
      </ComboBox>
      {references.error && <ProblemAlert error={references.error} />}
    </div>
  );
}
