import { useState } from "react";
import { Button, ToggleButton } from "react-aria-components";
import { useSearchParams } from "react-router";

import {
  filterItems,
  parseFilters,
  toSearchParams,
  type CatalogFilters,
} from "../catalog/catalogFilters";
import { CatalogItemSheet } from "../catalog/CatalogItemSheet";
import {
  foodCatalog,
  type Catalog,
  type CatalogItem,
} from "../catalog/catalogs";
import { LIST_LIMIT, useCatalogList } from "../catalog/queries";
import { fieldClass } from "../components/formStyles";
import { ProblemAlert } from "../components/ProblemAlert";
import { FoodSheet } from "../foods/FoodSheet";

const chipClass =
  "rounded-full border border-field px-3 py-1 text-base data-selected:border-action data-selected:bg-action data-selected:text-on-fill";
const tagClass = "rounded-full bg-inset px-2 text-sm text-on-inset";

interface CatalogPageProps {
  catalog: Catalog;
}

// Which sheet is open: an item's id, or null for the Add sheet. Not in the URL
// (ADR 0032): Back closes nothing, and a shared link never opens a form.
type OpenSheet = { id: string | null } | null;

// ADR 0032: one page per Catalog under Profile, to search, create, rename, archive
// and delete what logging created. The whole Catalog loads once and every filter runs
// in the browser, so typing never waits on the network.
export function CatalogPage({ catalog }: CatalogPageProps) {
  const hasNutrition = catalog === foodCatalog;
  const [params, setParams] = useSearchParams();
  const filters = parseFilters(params, hasNutrition);
  const list = useCatalogList(catalog, filters.archived);
  const [open, setOpen] = useState<OpenSheet>(null);

  // Replace, not push: Back should leave the page, not undo each keystroke.
  function update(change: Partial<CatalogFilters>) {
    setParams(toSearchParams({ ...filters, ...change }), { replace: true });
  }

  const close = () => {
    setOpen(null);
  };
  const openItem = ({ id }: { id: string }) => {
    setOpen({ id });
  };

  return (
    // Laid out like Home's window: at least a screen tall above the bar, so the Add
    // button sits at the bottom even on a short list. No Back link: tapping
    // Profile in the bar returns there.
    <main className="mx-auto flex min-h-[calc(100dvh-var(--tab-bar-footprint))] max-w-md flex-col gap-4 px-4 pb-(--tab-bar-gap)">
      {/* Pinned while the list scrolls under it: sticky, so the page keeps one scroll
          (no nested scroll box). It owns the page's top padding, so nothing shows
          above it once stuck, and an opaque background hides the rows passing under.
          z-10 stays under the tab bar (z-40) and sheets (z-50). */}
      <div className="sticky top-0 z-10 flex flex-col gap-4 border-b border-edge bg-page pt-4 pb-4">
        <h1 className="text-center text-xl font-semibold text-action-ink">
          {catalog.plural}
        </h1>

        <input
          type="search"
          aria-label={`Search ${catalog.plural}`}
          placeholder="Name contains"
          className={fieldClass}
          value={filters.q}
          onChange={({ target }) => {
            update({ q: target.value });
          }}
        />

        <div className="flex flex-wrap gap-2">
          {hasNutrition && (
            <ToggleButton
              className={chipClass}
              isSelected={filters.missing}
              onChange={(missing) => {
                update({ missing });
              }}
            >
              No nutrition yet
            </ToggleButton>
          )}
          <ToggleButton
            className={chipClass}
            isSelected={filters.archived}
            onChange={(archived) => {
              update({ archived });
            }}
          >
            Show archived
          </ToggleButton>
        </div>
      </div>

      {list.error && <ProblemAlert error={list.error} />}
      {list.data ? (
        <Results
          catalog={catalog}
          all={list.data}
          filters={filters}
          onOpen={openItem}
        />
      ) : (
        !list.error && (
          <p role="status" className="text-faint">
            Loading...
          </p>
        )
      )}

      {/* Sticky just above the bar, and last in the page, so when scrolled to the end
          it rests below the last item instead of covering it. */}
      <Button
        className="sticky bottom-[calc(var(--tab-bar-footprint)+var(--tab-bar-gap))] mt-auto w-full rounded-2xl bg-action p-4 text-lg font-semibold text-on-fill data-pressed:bg-action-pressed"
        onPress={() => {
          setOpen({ id: null });
        }}
      >
        Add {catalog.label}
      </Button>

      {/* Keyed on the item, so opening a clashing item from a sheet starts a fresh
          form instead of keeping this one's draft. */}
      {open &&
        (hasNutrition ? (
          <FoodSheet
            key={open.id ?? "new"}
            foodId={open.id}
            manage
            onClose={close}
            onOpen={openItem}
          />
        ) : (
          <CatalogItemSheet
            key={open.id ?? "new"}
            catalog={catalog}
            itemId={open.id}
            onClose={close}
            onOpen={openItem}
          />
        ))}
    </main>
  );
}

interface ResultsProps {
  catalog: Catalog;
  all: CatalogItem[];
  filters: CatalogFilters;
  onOpen: (item: CatalogItem) => void;
}

function Results({ catalog, all, filters, onOpen }: ResultsProps) {
  const items = filterItems(all, filters);
  return (
    <>
      {/* The cap is never silent (ADR 0032): a full answer may have left some out. */}
      {all.length === LIST_LIMIT && (
        <p className="text-sm text-muted">
          Showing the first {LIST_LIMIT.toLocaleString("en-US")}{" "}
          {catalog.plural}.
        </p>
      )}
      {items.length === 0 ? (
        <p className="text-faint">
          {all.length === 0
            ? `No ${catalog.plural} yet.`
            : `No ${catalog.plural} match.`}
        </p>
      ) : (
        <ul
          aria-label={catalog.plural}
          className="flex flex-col divide-y divide-edge"
        >
          {items.map((item) => (
            <li key={item.id}>
              <Button
                className="flex w-full flex-col items-start gap-1 py-3 text-left data-pressed:bg-inset"
                onPress={() => {
                  onOpen(item);
                }}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-medium">{item.name}</span>
                  {item.archived && <span className={tagClass}>Archived</span>}
                </span>
                {catalog === foodCatalog && <NutritionLine item={item} />}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

const grams = (value: number) => `${String(value)} g`;

// A Food's label as entered: calories per Basis, then the three macros.
function NutritionLine({ item }: { item: CatalogItem }) {
  const { nutrition } = item;
  if (nutrition == null) {
    return (
      <span className="rounded-full bg-warn-soft px-2 text-sm text-warn-ink">
        No nutrition yet
      </span>
    );
  }
  return (
    <span className="text-sm text-muted">
      {String(nutrition.kcal)} cal per {grams(nutrition.basis_g)} · P{" "}
      {grams(nutrition.protein_g)} · C {grams(nutrition.carbs_g)} · F{" "}
      {grams(nutrition.fat_g)}
    </span>
  );
}
