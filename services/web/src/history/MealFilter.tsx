import { useEffect, useEffectEvent, useState } from "react";
import { Button, Input, Label, SearchField } from "react-aria-components";

import { ClearIcon } from "../components/ClearIcon";
import { useDebouncedValue } from "../lib/useDebouncedValue";

// The combobox's pause: long enough that typing "chicken" asks once, short enough
// that the list keeps up.
export const FILTER_DEBOUNCE_MS = 150;

interface MealFilterProps {
  // The filter in the URL, which is what the list below reads.
  value: string;
  // Writes a new filter to the URL, already trimmed.
  onCommit: (q: string) => void;
}

// ADR 0033's Meals filter: "Filter Days", a substring of a Food or Restaurant name.
// The field keeps its own text so every keystroke shows at once, and hands it to
// the URL only once typing pauses. The URL change is what refetches Recent Days,
// so fast typing costs one request, not one per letter.
export function MealFilter({ value, onCommit }: MealFilterProps) {
  const [text, setText] = useState(value);
  const settled = useDebouncedValue(text.trim(), FILTER_DEBOUNCE_MS);

  // An Effect Event reads the latest `value` and `onCommit` without being a
  // dependency of the Effect below, so that Effect runs only when the typing
  // settles. If `value` were a dependency, clearing would write "" and re-run it
  // with the old settled text, which would put the cleared filter straight back.
  const commit = useEffectEvent((q: string) => {
    // Also skips the first run, when the field opens with the URL's own filter.
    if (q !== value) {
      onCommit(q);
    }
  });
  useEffect(() => {
    commit(settled);
  }, [settled]);

  return (
    <SearchField
      value={text}
      onChange={setText}
      // The × and Escape both clear. Clearing is one deliberate act, not typing,
      // so it skips the pause and restores every Day at once.
      onClear={() => {
        if (value !== "") {
          onCommit("");
        }
      }}
      className="flex flex-col gap-1"
    >
      <Label className="text-sm font-medium text-muted">Filter Days</Label>
      <div className="flex items-center rounded-xl border border-field bg-card focus-within:ring-2 focus-within:ring-action">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="ml-3 size-5 shrink-0 text-faint"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        {/* The browser's own clear button for type="search" is hidden: the × below
            does the same and looks the same on every phone. */}
        <Input
          placeholder="Food or Restaurant"
          className="w-full min-w-0 bg-transparent p-3 text-base outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {text !== "" && (
          // Inside a SearchField, a Button is its clear button: React Aria wires
          // its press to empty the field and call onClear.
          <Button
            aria-label="Clear"
            className="flex size-11 shrink-0 items-center justify-center text-faint"
          >
            <ClearIcon />
          </Button>
        )}
      </div>
    </SearchField>
  );
}
