import { useState, type SyntheticEvent } from "react";
import {
  Button,
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
import { BottomSheet } from "../components/BottomSheet";
import { NumberField, TextField } from "../components/Fields";
import { fieldClass } from "../components/formStyles";
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
  // null opens an empty sheet whose Save creates the Food (Profile's "+").
  foodId: string | null;
  onClose: () => void;
  // The Food as the server saved it, so the caller can show a new name at once.
  onSaved?: (food: Food) => void;
  // Profile's sheet (ADR 0032) adds Archive, Unarchive and Delete.
  manage?: boolean | undefined;
  // Opens a Food whose name clashes, in place of this one.
  onOpen?: (food: CatalogRef) => void;
}

// ADR 0023's Food sheet: a Food's name, Nutrition and Piece Weight, saved as one
// write. An existing Food is read first, because a Meal embeds only its name.
export function FoodSheet({ foodId, manage, ...form }: FoodSheetProps) {
  if (foodId === null) {
    // Nothing to archive or delete before the Food exists.
    return (
      <BottomSheet title="New Food" onClose={form.onClose}>
        <FoodForm food={null} {...form} />
      </BottomSheet>
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
    <BottomSheet title={food.data?.name ?? "Food"} onClose={form.onClose}>
      {food.data ? (
        <>
          <FoodForm food={food.data} {...form} />
          {manage && (
            <ItemActions
              catalog={foodCatalog}
              item={food.data}
              onDone={form.onClose}
            />
          )}
        </>
      ) : food.error ? (
        <ProblemAlert error={food.error} />
      ) : (
        <p role="status" className="text-gray-500">
          Loading...
        </p>
      )}
    </BottomSheet>
  );
}

type FoodFormProps = Omit<FoodSheetProps, "foodId" | "manage"> & {
  food: Food | null;
};

// Mounted only once the Food has loaded, so the draft starts from the server's
// values without an effect copying them in.
function FoodForm({ food, onClose, onSaved, onOpen }: FoodFormProps) {
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
    const done = {
      onSuccess: (saved: Food) => {
        onSaved?.(saved);
        onClose();
      },
    };
    if (food) {
      patchFood.mutate(body, done);
    } else {
      putFood.mutate(body, done);
    }
  }

  function save(event: SyntheticEvent) {
    event.preventDefault();
    send(false);
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={save} noValidate>
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
      {filledFrom && (
        <p role="status" className="text-sm text-gray-600">
          Filled from {filledFrom}. Check it against your label.
        </p>
      )}

      <fieldset className="flex flex-col gap-3">
        {/* First child, so it names the group for a screen reader. */}
        <legend className="mb-3 font-medium">Nutrition, as on the label</legend>
        <div className="grid grid-cols-2 gap-3">
          {NUTRITION_FIELDS.map((field) => (
            <NumberField
              key={field}
              label={NUTRITION_LABELS[field]}
              value={draft[field]}
              error={errors[field]}
              onChange={(value) => {
                change({ [field]: value });
              }}
            />
          ))}
          <Button
            aria-label="Clear Nutrition"
            className="self-end rounded-xl p-3 text-base text-teal-700"
            onPress={() => {
              change(Object.fromEntries(NUTRITION_FIELDS.map((f) => [f, ""])));
            }}
          >
            Clear
          </Button>
        </div>
        {errors.nutrition && (
          <p role="alert" className="text-sm text-red-800">
            {errors.nutrition}
          </p>
        )}
      </fieldset>

      <NumberField
        label="Piece Weight (g)"
        hint="Grams in one piece, so a count can be totalled."
        value={draft.piece_g}
        error={errors.piece_g}
        onChange={(piece_g) => {
          change({ piece_g });
        }}
      />

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
    <>
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
        <Input className={fieldClass} placeholder="Search Reference Foods" />
        <Popover className="w-(--trigger-width) overflow-auto rounded-xl border border-gray-200 bg-white shadow-lg">
          <ListBox<ReferenceFood>
            className="max-h-72 outline-none"
            renderEmptyState={() => (
              <p className="p-3 text-base text-gray-500">
                {references.isFetching ? "Searching..." : "No match"}
              </p>
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
                  {String(reference.nutrition.kcal)} kcal per{" "}
                  {String(reference.nutrition.basis_g)} g
                </span>
              </ListBoxItem>
            )}
          </ListBox>
        </Popover>
      </ComboBox>
      {references.error && <ProblemAlert error={references.error} />}
    </>
  );
}
