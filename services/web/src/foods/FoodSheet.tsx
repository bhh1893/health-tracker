import { useId, useState, type ReactNode, type SyntheticEvent } from "react";
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

import { ApiError } from "../api/client";
import { BottomSheet } from "../components/BottomSheet";
import { fieldClass, labelClass } from "../components/formStyles";
import { ProblemAlert } from "../components/ProblemAlert";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import {
  checkFood,
  draftOf,
  fillFrom,
  MAX_NAME_LENGTH,
  NUTRITION_FIELDS,
  type Food,
  type FoodDraft,
  type FoodErrors,
  type NutritionField,
  type ReferenceFood,
} from "./foodForm";
import { useFood, usePatchFood, useReferenceFoods } from "./queries";

const DEBOUNCE_MS = 150;
const NEAR_DUPLICATE = "urn:health-tracker:problem:near-duplicate";

const NUTRITION_LABELS: Record<NutritionField, string> = {
  basis_g: "Basis (g)",
  kcal: "Calories (kcal)",
  protein_g: "Protein (g)",
  carbs_g: "Carbs (g)",
  fat_g: "Fat (g)",
};

interface FoodSheetProps {
  foodId: string;
  onClose: () => void;
  // The Food as the server saved it, so the caller can show a new name at once.
  onSaved: (food: Food) => void;
}

// ADR 0023's Food sheet: a Food's name, Nutrition and Piece Weight, saved as one
// PATCH. It reads the Food first, because a Meal embeds only the Food's name.
export function FoodSheet({ foodId, onClose, onSaved }: FoodSheetProps) {
  const food = useFood(foodId);
  return (
    <BottomSheet title={food.data?.name ?? "Food"} onClose={onClose}>
      {food.data ? (
        <FoodForm food={food.data} onClose={onClose} onSaved={onSaved} />
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

interface FoodFormProps {
  food: Food;
  onClose: () => void;
  onSaved: (food: Food) => void;
}

// Mounted only once the Food has loaded, so the draft starts from the server's
// values without an effect copying them in.
function FoodForm({ food, onClose, onSaved }: FoodFormProps) {
  const [draft, setDraft] = useState<FoodDraft>(() => draftOf(food));
  const [filledFrom, setFilledFrom] = useState<string | null>(null);
  // Remounts the search after each pick, so it starts closed and empty, as the Meal
  // sheet's Add search does.
  const [searchKey, setSearchKey] = useState(0);
  // Errors show from the first Save on, not while the user is still typing the
  // first of five fields.
  const [triedSave, setTriedSave] = useState(false);
  const patchFood = usePatchFood(food.id);

  const check = checkFood(draft);
  const errors: FoodErrors = triedSave && !check.ok ? check.errors : {};
  const nearDuplicate =
    patchFood.error instanceof ApiError &&
    patchFood.error.problem.type === NEAR_DUPLICATE;

  function change(next: Partial<FoodDraft>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  function send(allowSimilar: boolean) {
    setTriedSave(true);
    if (!check.ok) {
      return;
    }
    patchFood.mutate(
      { ...check.body, allow_similar: allowSimilar },
      {
        onSuccess: (saved) => {
          onSaved(saved);
          onClose();
        },
      },
    );
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

      {patchFood.error && <ProblemAlert error={patchFood.error} />}

      <div className="sticky bottom-0 flex flex-col gap-3 bg-white py-2">
        {nearDuplicate && (
          <Button
            className="rounded-xl border border-gray-300 p-3 text-base"
            isDisabled={patchFood.isPending}
            onPress={() => {
              send(true);
            }}
          >
            Save "{draft.name.trim()}" anyway
          </Button>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Button
            className="rounded-xl p-3 text-base text-gray-600"
            onPress={onClose}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            className="rounded-xl bg-teal-700 p-3 text-base font-semibold text-white data-disabled:bg-gray-300"
            isDisabled={patchFood.isPending}
          >
            Save
          </Button>
        </div>
      </div>
    </form>
  );
}

interface FieldProps {
  label: string;
  value: string;
  error: string | undefined;
  hint?: string;
  onChange: (value: string) => void;
}

// One labelled input with its hint and error. Those two sit outside the <label>, or
// a screen reader would read them as part of the field's name; aria-describedby reads
// them after it instead.
function Field({
  label,
  hint,
  error,
  input,
}: Omit<FieldProps, "value" | "onChange"> & {
  input: (a11y: {
    id: string;
    "aria-invalid": boolean;
    "aria-describedby": string | undefined;
  }) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint && hintId, error && errorId]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={labelClass}>
      <label htmlFor={id}>{label}</label>
      {input({
        id,
        "aria-invalid": error !== undefined,
        "aria-describedby": describedBy === "" ? undefined : describedBy,
      })}
      {hint && (
        <span id={hintId} className="text-sm font-normal text-gray-500">
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} className="text-sm font-normal text-red-800">
          {error}
        </span>
      )}
    </div>
  );
}

function TextField({
  value,
  maxLength,
  onChange,
  ...field
}: FieldProps & { maxLength: number }) {
  return (
    <Field
      {...field}
      input={(a11y) => (
        <input
          {...a11y}
          type="text"
          maxLength={maxLength}
          className={fieldClass}
          value={value}
          onChange={({ target }) => {
            onChange(target.value);
          }}
        />
      )}
    />
  );
}

function NumberField({ value, onChange, ...field }: FieldProps) {
  return (
    <Field
      {...field}
      input={(a11y) => (
        <input
          {...a11y}
          type="number"
          inputMode="decimal"
          step="any"
          className={fieldClass}
          value={value}
          onChange={({ target }) => {
            onChange(target.value);
          }}
        />
      )}
    />
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
