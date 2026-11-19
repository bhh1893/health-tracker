import { formatAmount } from "../meals/meals";
import { Highlight } from "./Highlight";
import { useMealDays, type MealDay } from "./queries";
import { DayRow, RecentDays } from "./RecentDays";

interface MealDaysProps {
  from: string | null;
  to: string;
  // The filter, trimmed. Empty lists every Day.
  q: string;
}

// Recent Days on Meals: every Day in the Range with a Meal, or with `q`, only the
// Days with a Food or Restaurant whose name contains it (ADR 0033). A kept Day
// shows all of its Meals, with each match marked.
export function MealDays({ from, to, q }: MealDaysProps) {
  const pages = useMealDays(from, to, q);
  const loaded =
    pages.data?.pages.reduce((sum, page) => sum + page.items.length, 0) ?? 0;
  return (
    <RecentDays
      pages={pages}
      empty={
        q === ""
          ? "No Meals in this range."
          : `No Days with a Food or Restaurant matching "${q}".`
      }
      summary={
        q === "" || loaded === 0
          ? undefined
          : matchCount(loaded, pages.hasNextPage, q)
      }
      renderDay={(day) => (
        <DayRow
          key={day.day}
          day={day.day}
          // A Restaurant Day is any Day with a Restaurant Meal (ADR 0023).
          pill={isRestaurantDay(day) ? "ate out" : undefined}
        >
          <MealList day={day} q={q} />
        </DayRow>
      )}
    />
  );
}

const isRestaurantDay = (day: MealDay) =>
  day.meals.some((meal) => meal.kind === "restaurant");

// e.g. `5 Days with a Food or Restaurant matching "chicken"`. It counts the Days
// loaded so far, since the total is unknown until the last page: "20+ Days" while
// more pages remain.
function matchCount(loaded: number, more: boolean, q: string) {
  const days = loaded === 1 && !more ? "Day" : "Days";
  return `${String(loaded)}${more ? "+" : ""} ${days} with a Food or Restaurant matching "${q}"`;
}

// Each Food with its amount, or on a Restaurant Day, its Restaurants in orange.
// Only names are marked: they are what the filter matches.
function MealList({ day, q }: { day: MealDay; q: string }) {
  return (
    <ul className="px-3 pb-2">
      {day.meals.flatMap((meal) =>
        meal.kind === "restaurant" ? (
          <li
            key={meal.id}
            className="flex items-center gap-2 py-1.5 text-orange-800"
          >
            <ForkKnifeIcon />
            <span>
              <Highlight text={meal.restaurant.name} q={q} />
            </span>
          </li>
        ) : (
          meal.food_entries.map((entry, index) => (
            <li
              // A Meal may hold the same Food twice, so the Food id cannot be
              // the key.
              key={`${meal.id}-${String(index)}`}
              className="flex justify-between gap-3 py-1.5"
            >
              <span>
                <Highlight text={entry.food.name} q={q} />
              </span>
              <span className="whitespace-nowrap text-gray-600">
                {formatAmount(entry)}
              </span>
            </li>
          ))
        ),
      )}
    </ul>
  );
}

function ForkKnifeIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 3v8M5 3v4a2 2 0 0 0 4 0V3M7 11v10M17 21V3c-2 1-3 4-3 8h3" />
    </svg>
  );
}
