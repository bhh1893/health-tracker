import { Button } from "react-aria-components";

import { MealContents } from "./MealContents";
import { clockTime, mealName, type Meal } from "./meals";

interface MealCardProps {
  meal: Meal;
  number: number;
  onEdit: () => void;
}

// Tapping anywhere on the card edits the Meal (ADR 0008). The title is the one real
// button, and its ::after box stretches over the card: a screen reader or keyboard
// finds one named button, and a thumb can hit it anywhere.
export function MealCard({ meal, number, onEdit }: MealCardProps) {
  const name = mealName(number, meal.label);
  return (
    <article
      aria-label={name}
      className="relative rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
    >
      <div className="flex items-baseline justify-between">
        <Button
          aria-label={`Edit ${name}`}
          className="text-left text-lg font-semibold after:absolute after:inset-0 after:rounded-2xl data-pressed:after:bg-gray-900/5"
          onPress={onEdit}
        >
          {name}
        </Button>
        <span className="text-sm text-gray-500">{clockTime(meal)}</span>
      </div>
      <MealContents meal={meal} />
    </article>
  );
}
