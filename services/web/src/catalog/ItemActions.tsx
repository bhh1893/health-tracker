import { useState } from "react";
import { Button } from "react-aria-components";

import { ProblemAlert } from "../components/ProblemAlert";
import type { Catalog, CatalogItem } from "./catalogs";
import { useDeleteItem, useSetArchived } from "./queries";

interface ItemActionsProps {
  catalog: Catalog;
  item: CatalogItem;
  // Called once the item is archived, unarchived or deleted: the sheet closes.
  onDone: () => void;
}

const quietButton =
  "rounded-xl border border-gray-300 p-3 text-base data-pressed:bg-gray-100 data-disabled:text-gray-400";
const iconButton =
  "flex size-11 items-center justify-center rounded-full data-pressed:bg-gray-100 data-disabled:text-gray-300";

// The header of every Profile sheet (ADR 0032): small icons beside the title, so
// the form below stays the sheet's focus. Archive hides an item from logging and
// keeps its history; Delete removes it for good and is offered only while no Entry
// uses it, which `last_used_day` says. The API still refuses a used one (409), for
// an Entry logged since the list loaded. Rendered in Sheet's wrapping header
// row: the icons sit by the title, and the confirm and errors take full lines.
export function ItemActions({ catalog, item, onDone }: ItemActionsProps) {
  const setArchived = useSetArchived(catalog, item.id);
  const remove = useDeleteItem(catalog, item.id);
  // Delete cannot be undone, so it asks once more in place.
  const [confirming, setConfirming] = useState(false);
  const pending = setArchived.isPending || remove.isPending;
  const neverUsed = item.last_used_day == null;
  const archiveLabel = item.archived ? "Unarchive" : "Archive";

  return (
    <>
      <div
        role="group"
        aria-label={`Manage ${item.name}`}
        className="flex gap-1"
      >
        {/* aria-label is the button's name, since the icon has no text. title
            shows the same word on hover, on a computer. */}
        <Button
          aria-label={archiveLabel}
          className={`${iconButton} text-gray-600`}
          isDisabled={pending}
          onPress={() => {
            setArchived.mutate(!item.archived, { onSuccess: onDone });
          }}
        >
          <span title={archiveLabel}>
            <ArchiveIcon up={item.archived} />
          </span>
        </Button>
        {neverUsed && (
          <Button
            aria-label="Delete"
            className={`${iconButton} text-red-700`}
            isDisabled={pending || confirming}
            onPress={() => {
              setConfirming(true);
            }}
          >
            <span title="Delete">
              <TrashIcon />
            </span>
          </Button>
        )}
      </div>

      {confirming && (
        <div className="grid basis-full grid-cols-2 gap-3">
          <Button
            className={quietButton}
            onPress={() => {
              setConfirming(false);
            }}
          >
            Keep
          </Button>
          <Button
            className="rounded-xl bg-red-700 p-3 text-base font-semibold text-white data-disabled:bg-gray-300"
            isDisabled={pending}
            onPress={() => {
              remove.mutate(undefined, { onSuccess: onDone });
            }}
          >
            Delete for good
          </Button>
        </div>
      )}

      {setArchived.error && (
        <div className="basis-full">
          <ProblemAlert error={setArchived.error} />
        </div>
      )}
      {remove.error && (
        <div className="basis-full">
          <ProblemAlert error={remove.error} />
        </div>
      )}
    </>
  );
}

const iconProps = {
  "aria-hidden": true,
  viewBox: "0 0 24 24",
  className: "size-6",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

// A box with an arrow: into it to archive, out of it to unarchive.
function ArchiveIcon({ up }: { up: boolean }) {
  return (
    <svg {...iconProps}>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
      <path d={up ? "M12 17v-6m-3 3 3-3 3 3" : "M12 11v6m-3-3 3 3 3-3"} />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg {...iconProps}>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
    </svg>
  );
}
