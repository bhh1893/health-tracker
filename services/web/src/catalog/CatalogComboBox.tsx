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
import type { Catalog, CatalogItem, CatalogRef } from "./catalogs";
import { useCreateItem, useSuggestions, useUnarchiveItem } from "./queries";

const DEBOUNCE_MS = 150;
const CREATE_ROW = "create";
const EXACT_DUPLICATE = "urn:health-tracker:problem:exact-duplicate";
const NEAR_DUPLICATE = "urn:health-tracker:problem:near-duplicate";

// What the server said instead of creating the item. `id` is kept so that
// "create anyway" retries the same write.
interface Conflict {
  id: string;
  name: string;
  matches: CatalogRef[];
  canCreateAnyway: boolean;
}

interface CatalogComboBoxProps {
  catalog: Catalog;
  value: CatalogItem | null;
  onChange: (item: CatalogItem | null) => void;
  // Overrides the Catalog's label, e.g. "Add Food" in the Meal sheet.
  label?: string;
  // False for Search (ADR 0013): no Create row, archived items included, and text
  // that matches nothing says so.
  canCreate?: boolean;
}

// ADR 0008. React Aria supplies the combobox's roles, keyboard handling and screen
// reader announcements; this adds the search and the create flow. One component for
// every Catalog, so a fix to the create or "Did you mean?" flow lands everywhere.
// Search reuses it with canCreate={false}: picking works the same, only creating
// differs, so a flag beats a second copy of the picking logic.
export function CatalogComboBox({
  catalog,
  value,
  onChange,
  label = catalog.label,
  canCreate = true,
}: CatalogComboBoxProps) {
  const [text, setText] = useState(value?.name ?? "");
  const [conflict, setConflict] = useState<Conflict | null>(null);

  const trimmed = text.trim();
  // A picked item is not a search: keep showing recents, not its own name.
  const q = useDebouncedValue(
    trimmed === value?.name ? "" : trimmed,
    DEBOUNCE_MS,
  );
  const suggestions = useSuggestions(catalog, q, !canCreate);
  const createItem = useCreateItem(catalog);
  const unarchiveItem = useUnarchiveItem(catalog);

  const found = suggestions.data ?? [];
  // The picked row must stay in the list, or the combobox forgets the selection.
  const items =
    value === null || found.some(({ id }) => id === value.id)
      ? found
      : [value, ...found];
  const hasExactMatch = items.some(
    ({ name }) => name.toLowerCase() === trimmed.toLowerCase(),
  );
  const rows =
    !canCreate || trimmed === "" || hasExactMatch
      ? items
      : [...items, { id: CREATE_ROW, name: trimmed, archived: false }];

  function pick(item: CatalogItem) {
    setText(item.name);
    setConflict(null);
    createItem.reset();
    unarchiveItem.reset();
    onChange(item);
  }

  function create(id: string, name: string, allowSimilar: boolean) {
    createItem.mutate(
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
      unarchiveItem.mutate(match.id, { onSuccess: pick });
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

  const failure = createItem.error ?? unarchiveItem.error;
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
        value={createItem.isPending ? CREATE_ROW : (value?.id ?? null)}
        allowsCustomValue
        // Keeps the menu open on zero rows, so Search can say "No match".
        allowsEmptyCollection={!canCreate}
        menuTrigger="focus"
        onInputChange={(next) => {
          setText(next);
          // Typing over a picked item un-picks it, so an Entry can never be saved
          // under a name other than the one on screen.
          if (value && next !== value.name) {
            onChange(null);
          }
        }}
        onChange={selectRow}
      >
        <Label className="text-sm font-medium text-gray-600">{label}</Label>
        <div className="flex rounded-xl border border-gray-300 bg-white focus-within:ring-2 focus-within:ring-teal-600">
          <Input
            className="w-full min-w-0 rounded-xl bg-transparent p-3 text-base outline-none"
            placeholder={catalog.placeholder}
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
          <ListBox<CatalogItem>
            className="max-h-72 outline-none"
            renderEmptyState={() => (
              <p className="p-3 text-base text-gray-500">
                {suggestions.isFetching ? "Searching..." : "No match"}
              </p>
            )}
          >
            {(row) => (
              <ListBoxItem
                id={row.id}
                textValue={row.name}
                className="cursor-pointer p-3 text-base outline-none data-focused:bg-teal-50 data-selected:font-semibold"
              >
                {row.id === CREATE_ROW ? (
                  <span className="text-teal-700">+ Create "{row.name}"</span>
                ) : row.archived ? (
                  `${row.name} (archived)`
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
