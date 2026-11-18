import { formatAmount } from "../meals/meals";
import { useMealDays, type MealDay } from "./queries";
import { DayRow, RecentDays } from "./RecentDays";

// Recent Days on Meals: every Day in the Range with a Meal (ADR 0033).
export function MealDays({ from, to }: { from: string | null; to: string }) {
  const pages = useMealDays(from, to);
  return (
    <RecentDays
      pages={pages}
      empty="No Meals in this range."
      renderDay={(day, defaultExpanded) => (
        <DayRow
          key={day.day}
          day={day.day}
          defaultExpanded={defaultExpanded}
          // A Restaurant Day is any Day with a Restaurant Meal (ADR 0023).
          pill={isRestaurantDay(day) ? "Ate out" : undefined}
        >
          <MealList day={day} />
        </DayRow>
      )}
    />
  );
}

const isRestaurantDay = (day: MealDay) =>
  day.meals.some((meal) => meal.kind === "restaurant");

// Each Food with its amount, or on a Restaurant Day, its Restaurants in orange.
function MealList({ day }: { day: MealDay }) {
  return (
    <ul className="px-3 pb-2">
      {day.meals.flatMap((meal) =>
        meal.kind === "restaurant" ? (
          <li
            key={meal.id}
            className="flex items-center gap-2 py-1.5 text-orange-800"
          >
            <ForkKnifeIcon />
            {meal.restaurant.name}
          </li>
        ) : (
          meal.food_entries.map((entry, index) => (
            <li
              // A Meal may hold the same Food twice, so the Food id cannot be
              // the key.
              key={`${meal.id}-${String(index)}`}
              className="flex justify-between gap-3 py-1.5"
            >
              <span>{entry.food.name}</span>
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
