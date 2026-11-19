import { ForkKnifeIcon } from "../components/ForkKnifeIcon";
import { formatAmount, type Meal } from "./meals";

// What a Meal holds: its Foods and amounts, or its Restaurant in orange with the
// fork and knife, as History shows a Restaurant Meal.
export function MealContents({ meal }: { meal: Meal }) {
  return (
    <ul className="mt-1 flex flex-col gap-1">
      {meal.kind === "restaurant" ? (
        <li className="flex items-center gap-2 text-orange-800">
          <ForkKnifeIcon />
          <span>{meal.restaurant.name}</span>
        </li>
      ) : (
        meal.food_entries.map((entry, index) => (
          <li key={index} className="flex justify-between">
            <span>{entry.food.name}</span>
            <span className="text-gray-600">{formatAmount(entry)}</span>
          </li>
        ))
      )}
    </ul>
  );
}
