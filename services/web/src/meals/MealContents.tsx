import { formatAmount, type Meal } from "./meals";
import { RestaurantLine } from "./RestaurantLine";

// What a Meal holds: its Foods and amounts, or its Restaurants in pink, each with
// its Category's icon, as History shows a Restaurant Meal.
export function MealContents({ meal }: { meal: Meal }) {
  return (
    <ul className="mt-1 flex flex-col gap-1">
      {meal.kind === "restaurant" ? (
        <RestaurantLine restaurants={meal.restaurants} />
      ) : (
        meal.food_entries.map((entry, index) => (
          <li key={index} className="flex justify-between">
            <span>{entry.food.name}</span>
            <span className="text-muted">{formatAmount(entry)}</span>
          </li>
        ))
      )}
    </ul>
  );
}
