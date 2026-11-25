import { Button } from "react-aria-components";

import type { Catalog, CatalogItem } from "./catalogs";
import { useSuggestions } from "./queries";

const RECENT_CHIPS = 6;

interface RecentChipsProps {
  catalog: Catalog;
  onPick: (item: CatalogItem) => void;
  // A visible title over the chips, e.g. "Recent" on History.
  title?: string;
  // Pass the same value as the CatalogComboBox beside it (true when it cannot
  // create), so both read one cache entry.
  includeArchived?: boolean;
  // A chip for an item that cannot be picked now, e.g. a Restaurant already in the
  // Meal, shows but cannot be tapped.
  isDisabled?: (item: CatalogItem) => boolean;
}

// The most recently used items, one tap each. An empty q is the API's "recent"
// list (ADR 0008), and the same cache entry the search shows on focus.
export function RecentChips({
  catalog,
  onPick,
  title,
  includeArchived = false,
  isDisabled,
}: RecentChipsProps) {
  const recent = useSuggestions(catalog, "", includeArchived);
  const items = (recent.data ?? []).slice(0, RECENT_CHIPS);
  if (items.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-2">
      {title !== undefined && (
        <span className="text-sm text-muted">{title}</span>
      )}
      <div
        role="group"
        aria-label={`Recent ${catalog.label}s`}
        className="flex gap-2 overflow-x-auto pb-1"
      >
        {items.map((item) => (
          <Button
            key={item.id}
            className="shrink-0 rounded-full border border-field px-3 py-1 text-base whitespace-nowrap data-disabled:text-disabled data-pressed:bg-inset"
            isDisabled={isDisabled?.(item) ?? false}
            onPress={() => {
              onPick(item);
            }}
          >
            {item.name}
          </Button>
        ))}
      </div>
    </div>
  );
}
