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

// The bottom of every Profile sheet (ADR 0032). Archive hides an item from logging
// and keeps its history; Delete removes it for good and is offered only while no
// Entry uses it, which `last_used_day` says. The API still refuses a used one (409),
// for an Entry logged since the list loaded.
export function ItemActions({ catalog, item, onDone }: ItemActionsProps) {
  const setArchived = useSetArchived(catalog, item.id);
  const remove = useDeleteItem(catalog, item.id);
  // Delete cannot be undone, so it asks once more in place.
  const [confirming, setConfirming] = useState(false);
  const pending = setArchived.isPending || remove.isPending;
  const neverUsed = item.last_used_day == null;

  return (
    <section
      aria-label={`Manage ${item.name}`}
      className="flex flex-col gap-3 border-t border-gray-200 pt-4"
    >
      <Button
        className={quietButton}
        isDisabled={pending}
        onPress={() => {
          setArchived.mutate(!item.archived, { onSuccess: onDone });
        }}
      >
        {item.archived ? "Unarchive" : "Archive"}
      </Button>
      {!item.archived && (
        <p className="text-sm text-gray-500">
          Archived {catalog.plural} are hidden when logging. Their history
          stays.
        </p>
      )}

      {neverUsed &&
        (confirming ? (
          <div className="grid grid-cols-2 gap-3">
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
        ) : (
          <Button
            className="rounded-xl p-3 text-base font-semibold text-red-700"
            isDisabled={pending}
            onPress={() => {
              setConfirming(true);
            }}
          >
            Delete
          </Button>
        ))}

      {setArchived.error && <ProblemAlert error={setArchived.error} />}
      {remove.error && <ProblemAlert error={remove.error} />}
    </section>
  );
}
