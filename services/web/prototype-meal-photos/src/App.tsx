// PROTOTYPE, throwaway (issue #302). The Home tab's Meals window, cut down to what
// the photo question needs, with each variant's photo parts mounted inside it.
// Three variants, switchable with ?variant= and the purple bar.
import { useState, type ReactNode } from "react";

import { Sheet } from "../../src/components/Sheet";
import { PencilIcon } from "../../src/components/PencilIcon";
import { MealContents } from "../../src/meals/MealContents";
import type { Meal } from "../../src/meals/meals";
import { usePhotoDraft } from "./shared";
import { deleteMeal, newMeal, saveMeal, useMeals, type ProtoMeal } from "./store";
import { Switcher } from "./Switcher";
import { variantA } from "./VariantA";
import { variantB } from "./VariantB";
import { variantC } from "./VariantC";

export type Draft = ReturnType<typeof usePhotoDraft>;

export interface Variant {
  key: string;
  name: string;
  // The whole card's photo parts, in three slots of the real card's layout.
  Card: (props: { meal: ProtoMeal; title: ReactNode; pencil: ReactNode; contents: ReactNode }) => ReactNode;
  SheetPhotos: (props: { d: Draft; kind: ProtoMeal["kind"] }) => ReactNode;
  // Anything the window shows outside the cards, e.g. an upload tray.
  WindowExtra?: () => ReactNode;
}

const variants = [variantA, variantB, variantC];

type SheetState = { meal: Omit<ProtoMeal, "photos" | "number">; saved: ProtoMeal | null } | null;

export function App() {
  const [key, setKey] = useState(() => new URLSearchParams(location.search).get("variant") ?? "A");
  const variant = variants.find((v) => v.key === key) ?? variantA;
  const meals = useMeals();
  const [sheet, setSheet] = useState<SheetState>(null);

  function switchTo(next: string) {
    setKey(next);
    const url = new URL(location.href);
    url.searchParams.set("variant", next);
    history.replaceState(null, "", url);
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 p-4 pb-[calc(var(--tab-bar-footprint)+var(--tab-bar-gap))]">
      <header className="flex items-center justify-between rounded-2xl bg-card p-3 shadow-sm">
        <span className="text-faint">‹</span>
        <span className="font-semibold">Today</span>
        <span className="text-faint">›</span>
      </header>
      <main className="flex flex-1 flex-col gap-4">
        {meals.map((meal) => {
          const name = meal.label ?? "Meal";
          return (
            <variant.Card
              key={meal.id}
              meal={meal}
              title={<h3 className="text-lg font-semibold">{name}</h3>}
              pencil={
                <button
                  type="button"
                  aria-label={`Edit ${name}`}
                  className="-m-2 rounded-lg p-2 text-action active:bg-action-soft"
                  onClick={() => {
                    setSheet({ meal, saved: meal });
                  }}
                >
                  <PencilIcon />
                </button>
              }
              contents={<MealContents meal={meal as unknown as Meal} />}
            />
          );
        })}
        {variant.WindowExtra && <variant.WindowExtra />}
        <div className="sticky bottom-[calc(var(--tab-bar-footprint)+var(--tab-bar-gap))] mt-auto grid grid-cols-2 gap-3">
          <button
            type="button"
            className="rounded-full bg-food p-4 text-lg font-semibold text-on-fill"
            onClick={() => {
              setSheet({ meal: newMeal("foods"), saved: null });
            }}
          >
            Add Food
          </button>
          <button
            type="button"
            className="rounded-full bg-restaurant p-4 text-lg font-semibold text-on-fill"
            onClick={() => {
              setSheet({ meal: newMeal("restaurant"), saved: null });
            }}
          >
            Add Restaurant
          </button>
        </div>
      </main>
      {sheet && (
        <MealSheet
          key={sheet.meal.id}
          {...sheet}
          variant={variant}
          onClose={() => {
            setSheet(null);
          }}
        />
      )}
      <Switcher variants={variants} current={variant.key} onChange={switchTo} />
    </div>
  );
}

function MealSheet({
  meal,
  saved,
  variant,
  onClose,
}: {
  meal: Omit<ProtoMeal, "photos" | "number">;
  saved: ProtoMeal | null;
  variant: Variant;
  onClose: () => void;
}) {
  const d = usePhotoDraft(saved?.photos ?? []);
  const [confirming, setConfirming] = useState(false);
  const name = meal.label ?? "Meal";
  return (
    <Sheet title={saved ? `Edit ${name}` : `Add ${meal.kind === "foods" ? "Food" : "Restaurant"} to Today`} onClose={onClose} size="two-thirds">
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="rounded-xl border border-field p-3">
          <p className="text-xs text-faint">(Foods / Restaurants editing, as today)</p>
          <MealContents meal={{ ...meal, photos: [] } as unknown as Meal} />
        </div>
        <variant.SheetPhotos d={d} kind={meal.kind} />
        <div className="sticky bottom-0 mt-auto grid grid-cols-2 gap-3 bg-card py-2">
          {confirming && saved ? (
            <>
              <button type="button" className="rounded-xl p-3 text-muted" onClick={() => { setConfirming(false); }}>
                Keep
              </button>
              <button
                type="button"
                className="rounded-xl bg-danger p-3 font-semibold text-on-fill"
                onClick={() => {
                  deleteMeal(saved.id);
                  onClose();
                }}
              >
                Delete {name}
              </button>
            </>
          ) : (
            <>
              {saved ? (
                <button type="button" className="rounded-xl p-3 text-danger" onClick={() => { setConfirming(true); }}>
                  Delete Meal
                </button>
              ) : (
                <button type="button" className="rounded-xl p-3 text-muted" onClick={onClose}>
                  Cancel
                </button>
              )}
              <button
                type="button"
                className={`rounded-xl p-3 font-semibold text-on-fill ${meal.kind === "foods" ? "bg-food" : "bg-restaurant"}`}
                onClick={() => {
                  saveMeal(meal, d.draft);
                  onClose();
                }}
              >
                Save
              </button>
            </>
          )}
        </div>
      </div>
    </Sheet>
  );
}
