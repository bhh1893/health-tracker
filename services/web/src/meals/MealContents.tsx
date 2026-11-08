import { formatAmount, type Meal } from "./meals";

// What a Meal holds: its Foods and amounts, or its Restaurant. Shared by the
// editable Meal card and Search's read-only view.
export function MealContents({ meal }: { meal: Meal }) {
  return (
    <ul className="mt-1 flex flex-col gap-1">
      {meal.kind === "restaurant" ? (
        <li>At {meal.restaurant.name}</li>
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
