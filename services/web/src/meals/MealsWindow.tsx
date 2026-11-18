import { useState } from "react";
import { Button } from "react-aria-components";

import { DayPager } from "../components/DayPager";
import { ProblemAlert } from "../components/ProblemAlert";
import { formatDay } from "../lib/day";
import { useViewedDay } from "../lib/useViewedDay";
import { DayTotalSummary } from "../nutrition/DayTotalSummary";
import { useDayTotals } from "../nutrition/queries";
import { MealCard } from "./MealCard";
import { sortMeals, type Meal } from "./meals";
import { MealSheet } from "./MealSheet";
import { useDayMeals } from "./queries";

// Null sheet: closed. `saved` null: adding a new Meal.
type Sheet = { saved: Meal | null; number: number } | null;

export function MealsWindow() {
  const { day, isToday } = useViewedDay();
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
      {meals.isPending && <p className="text-gray-500">Loading...</p>}
      {meals.isSuccess && sorted.length === 0 && (
        <p className="text-gray-500">No Meals on this Day.</p>
      )}
      {sorted.map((meal, index) => (
        <MealCard
          key={meal.id}
          meal={meal}
          number={index + 1}
          onEdit={() => {
            setSheet({ saved: meal, number: index + 1 });
          }}
        />
      ))}

      {/* Sticky just above the bar, and last in the page, so when scrolled to the end
          it rests below the last card instead of covering it. */}
      <Button
        className="sticky bottom-[calc(var(--tab-bar-footprint)+var(--tab-bar-gap))] mt-auto w-full rounded-2xl bg-teal-700 p-4 text-lg font-semibold text-white"
        onPress={() => {
          setSheet({ saved: null, number: sorted.length + 1 });
        }}
      >
        {isToday ? "Add Meal" : `Add Meal to ${formatDay(day)}`}
      </Button>

      {sheet && (
        <MealSheet
          day={day}
          saved={sheet.saved}
          number={sheet.number}
          onClose={() => {
            setSheet(null);
          }}
        />
      )}
    </main>
  );
}
