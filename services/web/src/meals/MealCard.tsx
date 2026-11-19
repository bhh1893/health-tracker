import { Button } from "react-aria-components";

import { MealContents } from "./MealContents";
import { clockTime, mealName, type Meal } from "./meals";

interface MealCardProps {
  meal: Meal;
  number: number;
  onEdit: () => void;
}

// The Edit button under the time opens the Meal sheet (ADR 0008). Only the button
// edits, so a tap meant to scroll the feed cannot open a sheet by accident.
export function MealCard({ meal, number, onEdit }: MealCardProps) {
  const name = mealName(number, meal.label);
  return (
    // Two columns: the title and contents on the left, the time and Edit stacked
    // on the right. In one header row instead, the taller time + Edit stack would
    // push the contents down and leave a gap under the title.
    <article
      aria-label={name}
      className="grid grid-cols-[1fr_auto] gap-x-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
    >
      <h3 className="text-lg font-semibold">{name}</h3>
      <div className="row-span-2 flex flex-col items-end">
        <span className="text-sm leading-7 text-gray-500">
          {clockTime(meal)}
        </span>
        <Button
          aria-label={`Edit ${name}`}
          className="-mr-2 rounded-lg px-2 py-1 text-base text-teal-700 data-pressed:bg-teal-50"
          onPress={onEdit}
        >
          Edit
        </Button>
      </div>
      <MealContents meal={meal} />
    </article>
  );
}
