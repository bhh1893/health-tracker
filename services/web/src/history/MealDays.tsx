import { Fragment } from "react";

import {
  categoriesOf,
  categoryName,
  type RestaurantCategory,
} from "../catalog/restaurantCategory";
import { RestaurantLine } from "../meals/RestaurantLine";
import { Highlight } from "./Highlight";
import { useMealDays, type MealDay } from "./queries";
import { DayRow, RecentDays } from "./RecentDays";

interface MealDaysProps {
  from: string | null;
  to: string;
  // The filter, trimmed. Empty lists every Day.
  q: string;
  // Only Days with a Restaurant of this Category, or null for every Day (ADR 0041).
  category: RestaurantCategory | null;
}

// Recent Days on Meals: every Day in the Range with a Meal, or with `q`, only the
// Days with a Food or Restaurant whose name contains it (ADR 0033), and with
// `category`, only the Days with a Restaurant of it (ADR 0041). A kept Day shows
// all of its Meals, with each name match marked.
export function MealDays({ from, to, q, category }: MealDaysProps) {
  const pages = useMealDays(from, to, q, category);
  const filter = describeFilter(q, category);
  const loaded =
    pages.data?.pages.reduce((sum, page) => sum + page.items.length, 0) ?? 0;
  return (
    <RecentDays
      pages={pages}
      empty={filter === null ? "No Meals in this range." : `No Days ${filter}.`}
      summary={
        filter === null || loaded === 0
          ? undefined
          : matchCount(loaded, pages.hasNextPage, filter)
      }
      renderDay={(day) => (
        <DayRow
          key={day.day}
          day={day.day}
          homePath="/meals"
          // A Restaurant Day is any Day with a Restaurant Meal (ADR 0023). Its
          // badges name its Categories (ADR 0041).
          categories={dayCategories(day)}
        >
          <MealList day={day} q={q} />
        </DayRow>
      )}
    />
  );
}

// Every Category of every Restaurant Meal of the Day, each once. Empty on a Day
// with no Restaurant Meal.
const dayCategories = (day: MealDay) =>
  categoriesOf(
    day.meals.flatMap((meal) =>
      meal.kind === "restaurant" ? meal.restaurants : [],
    ),
  );

// What the filters keep, to end "N Days ..." or "No Days ...", e.g. `with a Food
// or Restaurant matching "chicken"` or `with drinks`. Null with no filter.
function describeFilter(q: string, category: RestaurantCategory | null) {
  const parts = [
    ...(q === "" ? [] : [`with a Food or Restaurant matching "${q}"`]),
    ...(category === null ? [] : [`with ${categoryName(category)}`]),
  ];
  return parts.length === 0 ? null : parts.join(" and ");
}

// e.g. `5 Days with a Food or Restaurant matching "chicken"`. It counts the Days
// loaded so far, since the total is unknown until the last page: "20+ Days" while
// more pages remain.
function matchCount(loaded: number, more: boolean, filter: string) {
  const days = loaded === 1 && !more ? "Day" : "Days";
  return `${String(loaded)}${more ? "+" : ""} ${days} ${filter}`;
}

// One line per Meal: its Foods' names, or on a Restaurant Meal its Restaurants in
// pink, joined by " · " and wrapping as needed. Amounts are left to Add's Meal
// card: History answers "what did I eat?". Only names are marked: they are what
// the filter matches.
function MealList({ day, q }: { day: MealDay; q: string }) {
  return (
    <ul className="px-3 pb-2">
      {day.meals.map((meal) =>
        meal.kind === "restaurant" ? (
          <RestaurantLine
            key={meal.id}
            className="py-1.5"
            restaurants={meal.restaurants}
            renderName={(name) => <Highlight text={name} q={q} />}
          />
        ) : (
          // One run of text, so a long Meal wraps like a sentence. A name with
          // no spaces may break mid-word rather than run off the screen.
          <li key={meal.id} className="py-1.5 wrap-break-word">
            {meal.food_entries.map((entry, index) => (
              // A Meal may hold the same Food twice, so the Food id cannot be
              // the key.
              <Fragment key={index}>
                {index > 0 && " · "}
                <Highlight text={entry.food.name} q={q} />
              </Fragment>
            ))}
          </li>
        ),
      )}
    </ul>
  );
}
