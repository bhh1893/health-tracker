import { useState } from "react";
import { Button } from "react-aria-components";

import { DayPager } from "../components/DayPager";
import { ProblemAlert } from "../components/ProblemAlert";
import { useViewedDay } from "../lib/useViewedDay";
import { DayTotalSummary } from "../nutrition/DayTotalSummary";
import { useDayTotals } from "../nutrition/queries";
import { MealCard } from "./MealCard";
import { sortMeals, type Meal } from "./meals";
import { MealSheet } from "./MealSheet";
import { useDayMeals } from "./queries";

// Null sheet: closed. `saved` null: adding a new Meal of `kind`.
type Sheet = { saved: Meal } | { saved: null; kind: Meal["kind"] } | null;

const addClass = "rounded-2xl p-4 text-lg font-semibold text-on-fill";

export function MealsWindow() {
  const { day } = useViewedDay();
  const meals = useDayMeals(day);
  // The same query Search and Dashboards read, narrowed to one Day, so every write
  // that already refreshes their totals (a Meal, a Food, the Restaurant Day value)
  // refreshes this one too. Empty for a Day with no Meals.
  const totals = useDayTotals(day, day);
  const total = totals.data?.[0];
  const [sheet, setSheet] = useState<Sheet>(null);

  const sorted = sortMeals(meals.data ?? []);

  return (
    <main className="flex flex-1 flex-col gap-4">
      <h2 className="sr-only">Meals on {day}</h2>
      <DayPager />
      {total && <DayTotalSummary total={total} />}
      {meals.error && <ProblemAlert error={meals.error} />}
      {/* One alert is enough when the server is unreachable for both. */}
      {totals.error && !meals.error && <ProblemAlert error={totals.error} />}
      {meals.isPending && <p className="text-faint">Loading...</p>}
      {meals.isSuccess && sorted.length === 0 && (
        <p className="text-faint">No Meals on this Day.</p>
      )}
      {sorted.map((meal) => (
        <MealCard
          key={meal.id}
          meal={meal}
          onEdit={() => {
            setSheet({ saved: meal });
          }}
        />
      ))}

      {/* Sticky just above the bar, and last in the page, so when scrolled to the end
          it rests below the last card instead of covering it. One button per kind,
          so the sheet needs no Foods | Restaurant switch. The labels stay short to
          fit side by side; the sheet's title names the Day. */}
      <div className="sticky bottom-[calc(var(--tab-bar-footprint)+var(--tab-bar-gap))] mt-auto grid grid-cols-2 gap-3">
        <Button
          className={`${addClass} bg-food`}
          onPress={() => {
            setSheet({ saved: null, kind: "foods" });
          }}
        >
          Add Food
        </Button>
        <Button
          className={`${addClass} bg-restaurant`}
          onPress={() => {
            setSheet({ saved: null, kind: "restaurant" });
          }}
        >
          Add Restaurant
        </Button>
      </div>

      {sheet && (
        <MealSheet
          {...sheet}
          day={day}
          onClose={() => {
            setSheet(null);
          }}
        />
      )}
    </main>
  );
}
