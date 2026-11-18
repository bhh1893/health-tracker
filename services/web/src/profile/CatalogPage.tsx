import { useState } from "react";
import { Button, ToggleButton } from "react-aria-components";
import { Link, useSearchParams } from "react-router";

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
  "rounded-full border border-gray-300 px-3 py-1 text-base data-selected:border-teal-700 data-selected:bg-teal-700 data-selected:text-white";
const tagClass = "rounded-full bg-gray-100 px-2 text-sm text-gray-600";

interface CatalogPageProps {
  catalog: Catalog;
}

// Which sheet is open: an item's id, or null for the "+" sheet. Not in the URL
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
    <main className="mx-auto flex max-w-md flex-col gap-4 p-4">
      <header className="flex items-center gap-4">
        {/* The page lives under Profile, so Back goes up to it (ADR 0031). */}
        <Link className="text-teal-700 underline" to="/profile">
          Back
        </Link>
        <h1 className="flex-1 text-xl font-semibold">{catalog.plural}</h1>
        <Button
          aria-label={`New ${catalog.label}`}
          className="flex size-11 items-center justify-center rounded-full bg-teal-700 text-2xl text-white data-pressed:bg-teal-900"
          onPress={() => {
            setOpen({ id: null });
          }}
        >
          +
        </Button>
      </header>

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
          <p role="status" className="text-gray-500">
            Loading...
          </p>
        )
      )}

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
        <p className="text-sm text-gray-600">
          Showing the first {LIST_LIMIT.toLocaleString("en-US")}{" "}
          {catalog.plural}.
        </p>
      )}
      {items.length === 0 ? (
        <p className="text-gray-500">
          {all.length === 0
            ? `No ${catalog.plural} yet. Tap + to add one.`
            : `No ${catalog.plural} match.`}
        </p>
      ) : (
        <ul
          aria-label={catalog.plural}
          className="flex flex-col divide-y divide-gray-200"
        >
          {items.map((item) => (
            <li key={item.id}>
              <Button
                className="flex w-full flex-col items-start gap-1 py-3 text-left data-pressed:bg-gray-50"
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
      <span className="rounded-full bg-amber-100 px-2 text-sm text-amber-900">
        No nutrition yet
      </span>
    );
  }
  return (
    <span className="text-sm text-gray-600">
      {String(nutrition.kcal)} kcal per {grams(nutrition.basis_g)} · P{" "}
      {grams(nutrition.protein_g)} · C {grams(nutrition.carbs_g)} · F{" "}
      {grams(nutrition.fat_g)}
    </span>
  );
}
