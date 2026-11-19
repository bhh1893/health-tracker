import { useState, type SyntheticEvent } from "react";
import { Button } from "react-aria-components";

import { BottomSheet } from "../components/BottomSheet";
import { TextField } from "../components/Fields";
import { ProblemAlert } from "../components/ProblemAlert";
import { uuidv7 } from "../lib/uuidv7";
import {
  MAX_NAME_LENGTH,
  type Catalog,
  type CatalogItem,
  type CatalogRef,
} from "./catalogs";
import { ItemActions } from "./ItemActions";
import { NameClash } from "./NameClash";
import { nameClashOf } from "./nameClash";
import { useCatalogItem, useCreateItem, useRenameItem } from "./queries";

interface CatalogItemSheetProps {
  catalog: Catalog;
  // null opens an empty sheet whose Save creates the item (a Profile Catalog page's Add button).
  itemId: string | null;
  onClose: () => void;
  // Opens an item whose name clashes, in place of this one.
  onOpen: (item: CatalogRef) => void;
}

// ADR 0032's sheet for a Restaurant or an Exercise: a name and nothing else to edit,
// then Archive, Unarchive or Delete. Foods have their own sheet, with Nutrition.
export function CatalogItemSheet({
  catalog,
  itemId,
  ...form
}: CatalogItemSheetProps) {
  if (itemId === null) {
    return (
      <BottomSheet title={`New ${catalog.label}`} onClose={form.onClose}>
        <NameForm catalog={catalog} item={null} {...form} />
      </BottomSheet>
    );
  }
  return <SavedItemSheet catalog={catalog} itemId={itemId} {...form} />;
}

function SavedItemSheet({
  catalog,
  itemId,
  ...form
}: CatalogItemSheetProps & { itemId: string }) {
  // Read by id, not taken from the list: a clash can open an archived item the
  // list is not showing.
  const item = useCatalogItem(catalog, itemId);
  return (
    <BottomSheet
      title={item.data?.name ?? catalog.label}
      onClose={form.onClose}
      actions={
        item.data && (
          <ItemActions
            catalog={catalog}
            item={item.data}
            onDone={form.onClose}
          />
        )
      }
    >
      {item.data ? (
        <NameForm catalog={catalog} item={item.data} {...form} />
      ) : item.error ? (
        <ProblemAlert error={item.error} />
      ) : (
        <p role="status" className="text-gray-500">
          Loading...
        </p>
      )}
    </BottomSheet>
  );
}

interface NameFormProps {
  catalog: Catalog;
  item: CatalogItem | null;
  onClose: () => void;
  onOpen: (item: CatalogRef) => void;
}

// Mounted once the item has loaded, so the name starts from the server's.
function NameForm({ catalog, item, onClose, onOpen }: NameFormProps) {
  const [name, setName] = useState(item?.name ?? "");
  const [triedSave, setTriedSave] = useState(false);
  // Made once per sheet, so "Save anyway" after a clash creates the same item.
  const [newId] = useState(uuidv7);
  const createItem = useCreateItem(catalog);
  const renameItem = useRenameItem(catalog, item?.id ?? newId);
  const write = item ? renameItem : createItem;

  const trimmed = name.trim();
  const error =
    trimmed === ""
      ? `A ${catalog.label} needs a name.`
      : trimmed.length > MAX_NAME_LENGTH
        ? `At most ${String(MAX_NAME_LENGTH)} characters.`
        : undefined;
  const clash = nameClashOf(write.error);

  function send(allowSimilar: boolean) {
    setTriedSave(true);
    if (error !== undefined) {
      return;
    }
    // Nothing changed, so there is nothing to send.
    if (trimmed === item?.name) {
      onClose();
      return;
    }
    const done = { onSuccess: onClose };
    if (item) {
      renameItem.mutate({ name: trimmed, allowSimilar }, done);
    } else {
      createItem.mutate({ id: newId, name: trimmed, allowSimilar }, done);
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
        value={name}
        error={triedSave ? error : undefined}
        maxLength={MAX_NAME_LENGTH}
        onChange={(next) => {
          setName(next);
          // A clash was about the name as sent. Once it changes, "Save anyway"
          // would vouch for a name the server never checked.
          write.reset();
        }}
      />

      {clash ? (
        <NameClash
          clash={clash}
          name={trimmed}
          pending={write.isPending}
          onSaveAnyway={() => {
            send(true);
          }}
          onOpen={onOpen}
        />
      ) : (
        write.error && <ProblemAlert error={write.error} />
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
          isDisabled={write.isPending}
        >
          Save
        </Button>
      </div>
    </form>
  );
}
