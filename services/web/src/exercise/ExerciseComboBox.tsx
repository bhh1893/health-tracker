import { useState } from "react";
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
import { ProblemAlert } from "../components/ProblemAlert";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { uuidv7 } from "../lib/uuidv7";
import {
  useCreateExercise,
  useExerciseSuggestions,
  useUnarchiveExercise,
} from "./queries";
import type { CatalogRef } from "./sessions";

const DEBOUNCE_MS = 150;
const CREATE_ROW = "create";
const EXACT_DUPLICATE = "urn:health-tracker:problem:exact-duplicate";
const NEAR_DUPLICATE = "urn:health-tracker:problem:near-duplicate";

// What the server said instead of creating the Exercise. `id` is kept so that
// "create anyway" retries the same write.
interface Conflict {
  id: string;
  name: string;
  matches: CatalogRef[];
  canCreateAnyway: boolean;
}

interface ExerciseComboBoxProps {
  value: CatalogRef | null;
  onChange: (exercise: CatalogRef | null) => void;
}

// ADR 0008. React Aria supplies the combobox's roles, keyboard handling and screen
// reader announcements; this adds the search and the create flow.
export function ExerciseComboBox({ value, onChange }: ExerciseComboBoxProps) {
  const [text, setText] = useState(value?.name ?? "");
  const [conflict, setConflict] = useState<Conflict | null>(null);

  const trimmed = text.trim();
  // A picked Exercise is not a search: keep showing recents, not its own name.
  const q = useDebouncedValue(
    trimmed === value?.name ? "" : trimmed,
    DEBOUNCE_MS,
  );
  const suggestions = useExerciseSuggestions(q);
  const createExercise = useCreateExercise();
  const unarchiveExercise = useUnarchiveExercise();

  const found = suggestions.data ?? [];
  // The picked row must stay in the list, or the combobox forgets the selection.
  const exercises =
    value === null || found.some(({ id }) => id === value.id)
      ? found
      : [value, ...found];
  const hasExactMatch = exercises.some(
    ({ name }) => name.toLowerCase() === trimmed.toLowerCase(),
  );
  const rows =
    trimmed === "" || hasExactMatch
      ? exercises
      : [...exercises, { id: CREATE_ROW, name: trimmed, archived: false }];

  function pick(exercise: CatalogRef) {
    setText(exercise.name);
    setConflict(null);
    createExercise.reset();
    unarchiveExercise.reset();
    onChange(exercise);
  }

  function create(id: string, name: string, allowSimilar: boolean) {
    createExercise.mutate(
      { id, name, allowSimilar },
      {
        onSuccess: pick,
        onError: (error) => {
          if (!(error instanceof ApiError)) {
            return;
          }
          const { type, existing, similar } = error.problem;
          if (type === EXACT_DUPLICATE && existing) {
            if (existing.archived) {
              setConflict({
                id,
                name,
                matches: [existing],
                canCreateAnyway: false,
              });
            } else {
              pick(existing);
            }
          } else if (type === NEAR_DUPLICATE && similar) {
            setConflict({
              id,
              name,
              matches: similar,
              canCreateAnyway: true,
            });
          }
        },
      },
    );
  }

  function chooseMatch(match: CatalogRef) {
    if (match.archived) {
      unarchiveExercise.mutate(match.id, { onSuccess: pick });
    } else {
      pick(match);
    }
  }

  function selectRow(key: Key | null) {
    if (key === CREATE_ROW) {
      create(uuidv7(), trimmed, false);
      return;
    }
    const row = rows.find(({ id }) => id === key);
    if (row) {
      pick(row);
    }
  }

  const failure = createExercise.error ?? unarchiveExercise.error;
  const showFailure =
    failure !== null &&
    !(
      failure instanceof ApiError &&
      (failure.problem.type === EXACT_DUPLICATE ||
        failure.problem.type === NEAR_DUPLICATE)
    );

  return (
    <>
      <ComboBox
        className="flex min-w-0 flex-col gap-1"
        inputValue={text}
        items={rows}
        // The Create row counts as selected while it runs. A combobox closes its menu
        // when the selection changes, and an open menu would cover any error.
        value={createExercise.isPending ? CREATE_ROW : (value?.id ?? null)}
        allowsCustomValue
        menuTrigger="focus"
        onInputChange={(next) => {
          setText(next);
          // Typing over a picked Exercise un-picks it, so a Set can never be saved
          // under a name other than the one on screen.
          if (value && next !== value.name) {
            onChange(null);
          }
        }}
        onChange={selectRow}
      >
        <Label className="text-sm font-medium text-gray-600">Exercise</Label>
        <div className="flex rounded-xl border border-gray-300 bg-white focus-within:ring-2 focus-within:ring-teal-600">
          <Input
            className="w-full min-w-0 rounded-xl bg-transparent p-3 text-base outline-none"
            placeholder="Search Exercises"
          />
          <Button aria-label="Show suggestions" className="px-3 text-gray-400">
            ▾
          </Button>
        </div>
        {suggestions.isFetching && (
          <p role="status" className="text-sm text-gray-500">
            Searching...
          </p>
        )}
        <Popover className="w-(--trigger-width) overflow-auto rounded-xl border border-gray-200 bg-white shadow-lg">
          <ListBox<CatalogRef> className="max-h-72 outline-none">
            {(row) => (
              <ListBoxItem
                id={row.id}
                textValue={row.name}
                className="cursor-pointer p-3 text-base outline-none data-focused:bg-teal-50 data-selected:font-semibold"
              >
                {row.id === CREATE_ROW ? (
                  <span className="text-teal-700">+ Create "{row.name}"</span>
                ) : (
                  row.name
                )}
              </ListBoxItem>
            )}
          </ListBox>
        </Popover>
      </ComboBox>
      {suggestions.error && <ProblemAlert error={suggestions.error} />}
      {showFailure && <ProblemAlert error={failure} />}

      {conflict && (
        <BottomSheet
          title={
            conflict.canCreateAnyway
              ? "Did you mean?"
              : `"${conflict.name}" is archived`
          }
          onClose={() => {
            setConflict(null);
          }}
        >
          {conflict.matches.map((match) => (
            <Button
              key={match.id}
              className="rounded-xl border border-gray-300 p-3 text-left text-base data-pressed:bg-gray-100"
              onPress={() => {
                chooseMatch(match);
              }}
            >
              {match.archived ? `Unarchive ${match.name}` : `Use ${match.name}`}
            </Button>
          ))}
          {conflict.canCreateAnyway && (
            <Button
              className="rounded-xl bg-teal-700 p-3 text-base text-white"
              onPress={() => {
                create(conflict.id, conflict.name, true);
              }}
            >
              Create "{conflict.name}" anyway
            </Button>
          )}
          <Button slot="close" className="p-2 text-base text-gray-600">
            Cancel
          </Button>
        </BottomSheet>
      )}
    </>
  );
}
