import { useState } from "react";
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

import { ApiError } from "../api/client";
import { Sheet } from "../components/Sheet";
import { ClearIcon } from "../components/ClearIcon";
import { ProblemAlert } from "../components/ProblemAlert";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { uuidv7 } from "../lib/uuidv7";
import type { Catalog, CatalogItem, CatalogRef } from "./catalogs";
import { EXACT_DUPLICATE, NEAR_DUPLICATE } from "./nameClash";
import { useCreateItem, useSuggestions, useUnarchiveItem } from "./queries";

const DEBOUNCE_MS = 150;
const CREATE_ROW = "create";

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

  // An item picked from outside the box (a chip, or Back to an older URL) shows
  // its name. React's "adjust state when a prop changes": compare with the last
  // value seen during render, not in an effect, so the stale text never paints.
  // A value going to null leaves the text alone: that is the user typing over it.
  const [shownId, setShownId] = useState(value?.id);
  if (value?.id !== shownId) {
    setShownId(value?.id);
    if (value !== null) {
      setText(value.name);
    }
  }

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
        <Label className="text-sm font-medium text-muted">{label}</Label>
        <div className="flex rounded-xl border border-field bg-card focus-within:ring-2 focus-within:ring-action">
          <Input
            className="w-full min-w-0 rounded-xl bg-transparent p-3 text-base outline-none"
            placeholder={catalog.placeholder}
          />
          {text !== "" && (
            // ComboBox hands every Button inside it the menu trigger's props
            // through ButtonContext. Null opts this one out, so it clears
            // instead of toggling the menu. Suggestions stay open on focus, so
            // the box needs no toggle of its own.
            <ButtonContext.Provider value={null}>
              <Button
                aria-label="Clear"
                className="flex size-11 shrink-0 items-center justify-center text-faint"
                onPress={() => {
                  setText("");
                  if (value !== null) {
                    onChange(null);
                  }
                }}
              >
                <ClearIcon />
              </Button>
            </ButtonContext.Provider>
          )}
        </div>
        {/* No "Searching..." line: it pushed the form down on every keystroke.
            Rows from the last search stay until the next arrive, and an empty
            menu stays hidden until there is something to say. */}
        <Popover
          // Always below the box. By default the menu flips above when there
          // is less room below than it wants, so it jumped sides as the rows
          // changed. Pinned, it shrinks to the room below and scrolls instead.
          placement="bottom"
          shouldFlip={false}
          className={
            rows.length === 0 && suggestions.isFetching
              ? "hidden"
              : "w-(--trigger-width) overflow-auto rounded-xl border border-edge bg-card shadow-lg"
          }
        >
          <ListBox<CatalogItem>
            className="max-h-72 outline-none"
            renderEmptyState={() => (
              <p className="p-3 text-base text-faint">No match</p>
            )}
          >
            {(row) => (
              <ListBoxItem
                id={row.id}
                textValue={row.name}
                className="cursor-pointer p-3 text-base outline-none data-focused:bg-action-soft data-selected:font-semibold"
              >
                {row.id === CREATE_ROW ? (
                  <span className="text-action">+ Create "{row.name}"</span>
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
        <Sheet
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
              className="rounded-xl border border-field p-3 text-left text-base data-pressed:bg-inset"
              onPress={() => {
                chooseMatch(match);
              }}
            >
              {match.archived ? `Unarchive ${match.name}` : `Use ${match.name}`}
            </Button>
          ))}
          {conflict.canCreateAnyway && (
            <Button
              className="rounded-xl bg-action p-3 text-base text-on-fill"
              onPress={() => {
                create(conflict.id, conflict.name, true);
              }}
            >
              Create "{conflict.name}" anyway
            </Button>
          )}
          <Button slot="close" className="p-2 text-base text-muted">
            Cancel
          </Button>
        </Sheet>
      )}
    </>
  );
}
