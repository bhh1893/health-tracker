// PROTOTYPE, throwaway (issue #14).
// Accessible typeahead over a Catalog, built on React Aria's ComboBox.
// React Aria supplies keyboard nav, ARIA roles and screen-reader announcements;
// we supply the styling and the "create new" + near-duplicate flow (ADR 0006).
import { useState } from "react";
import {
  Button,
  ComboBox,
  Dialog,
  Heading,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Modal,
  ModalOverlay,
  Popover,
} from "react-aria-components";
import { createItem, suggest, unarchive, type Item, type Kind } from "./stub";

const CREATE = "__create__";

type Pending = { name: string; similar: Item[] } | { name: string; archived: Item } | null;

export function CatalogCombo(props: {
  kind: Kind;
  label: string;
  value: Item | null;
  onChange: (item: Item | null) => void;
  hint?: string;
  big?: boolean;
  autoFocus?: boolean;
}) {
  const { kind, value, onChange } = props;
  const [text, setText] = useState(value?.name ?? "");
  const [pending, setPending] = useState<Pending>(null);
  const [, bump] = useState(0); // catalogs mutate in place; force refresh after create

  const items: Item[] = suggest(kind, text);
  if (value && !items.some((i) => i.id === value.id)) items.unshift(value);
  const trimmed = text.trim();
  const exactShown = items.some((i) => i.name.toLowerCase() === trimmed.toLowerCase());
  const rows = trimmed && !exactShown ? [...items, { id: CREATE, name: trimmed }] : items;

  const pick = (item: Item) => {
    setText(item.name);
    onChange(item);
    setPending(null);
    bump((n) => n + 1);
  };

  const tryCreate = (name: string, allowSimilar = false) => {
    const r = createItem(kind, name, allowSimilar);
    if (r.status === 201) return pick(r.item);
    if ("exact" in r) return r.exact.archived ? setPending({ name, archived: r.exact }) : pick(r.exact);
    setPending({ name, similar: r.similar });
  };

  const size = props.big ? "text-2xl py-4" : "py-3";

  return (
    <>
      <ComboBox
        className="flex flex-col gap-1"
        inputValue={text}
        onInputChange={(t) => {
          setText(t);
          // Typing over a picked item un-picks it; selecting a row also sets the text, so ignore that.
          if (value && t !== value.name && !rows.some((r) => r.name === t)) onChange(null);
        }}
        items={rows}
        selectedKey={value?.id ?? null}
        onSelectionChange={(key) => {
          if (key === CREATE) return tryCreate(trimmed);
          const item = rows.find((i) => i.id === key);
          if (item) pick(item);
        }}
        allowsCustomValue
        menuTrigger="focus"
        autoFocus={props.autoFocus}
      >
        <Label className="text-sm font-medium text-stone-600">{props.label}</Label>
        <div className="flex rounded-xl border border-stone-300 bg-white focus-within:ring-2 focus-within:ring-emerald-500">
          <Input
            className={`min-w-0 flex-1 rounded-xl bg-transparent px-3 outline-none ${size}`}
            placeholder={`Search ${kind}s`}
          />
          <Button className="px-3 text-stone-400" aria-label="Show suggestions">
            ▾
          </Button>
        </div>
        {props.hint && <p className="text-sm text-stone-500">{props.hint}</p>}
        <Popover className="w-(--trigger-width) overflow-auto rounded-xl border border-stone-200 bg-white shadow-lg">
          <ListBox className="max-h-72 outline-none">
            {(item: Item) => (
              <ListBoxItem
                id={item.id}
                textValue={item.name}
                className="cursor-pointer px-3 py-3 outline-none data-focused:bg-emerald-50 data-selected:font-semibold"
              >
                {item.id === CREATE ? (
                  <span className="text-emerald-700">+ Create "{item.name}"</span>
                ) : (
                  item.name
                )}
              </ListBoxItem>
            )}
          </ListBox>
        </Popover>
      </ComboBox>

      <ModalOverlay
        isOpen={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        isDismissable
        className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      >
        <Modal className="w-full max-w-md rounded-t-2xl bg-white p-5 sm:rounded-2xl">
          <Dialog className="flex flex-col gap-3 outline-none">
            {pending && "similar" in pending && (
              <>
                <Heading slot="title" className="text-lg font-semibold">
                  Did you mean one of these?
                </Heading>
                <p className="text-stone-600">"{pending.name}" looks close to an existing {kind}.</p>
                {pending.similar.map((s) => (
                  <Button
                    key={s.id}
                    onPress={() => (s.archived ? pick(unarchive(s)) : pick(s))}
                    className="rounded-xl border border-stone-300 px-4 py-3 text-left data-pressed:bg-stone-100"
                  >
                    Use <b>{s.name}</b>
                    {s.archived && <span className="text-stone-500"> (archived, will unarchive)</span>}
                  </Button>
                ))}
                <Button
                  onPress={() => tryCreate(pending.name, true)}
                  className="rounded-xl bg-stone-900 px-4 py-3 text-white data-pressed:bg-stone-700"
                >
                  Create "{pending.name}" anyway
                </Button>
              </>
            )}
            {pending && "archived" in pending && (
              <>
                <Heading slot="title" className="text-lg font-semibold">
                  "{pending.archived.name}" is archived
                </Heading>
                <Button
                  onPress={() => pick(unarchive(pending.archived))}
                  className="rounded-xl bg-stone-900 px-4 py-3 text-white"
                >
                  Unarchive and use it
                </Button>
              </>
            )}
            <Button slot="close" className="py-2 text-stone-500">
              Cancel
            </Button>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </>
  );
}
