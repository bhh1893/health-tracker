import { Button } from "react-aria-components";

import { PencilIcon } from "../components/PencilIcon";
import { MealContents } from "./MealContents";
import { mealName, type Meal } from "./meals";

interface MealCardProps {
  meal: Meal;
  onEdit: () => void;
}

// The pencil beside the title opens the Meal sheet (ADR 0008). Only the button
// edits, so a tap meant to scroll the feed cannot open a sheet by accident. The
// card shows no time: the feed's order already says which Meal came first.
export function MealCard({ meal, onEdit }: MealCardProps) {
  const name = mealName(meal.label);
  return (
    <article
      aria-label={name}
      className="rounded-2xl border border-edge bg-card p-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-semibold">{name}</h3>
        {/* -m-2 with p-2 gives a 36px tap target without pushing the title down. */}
        <Button
          aria-label={`Edit ${name}`}
          className="-m-2 rounded-lg p-2 text-action data-pressed:bg-action-soft"
          onPress={onEdit}
        >
          <PencilIcon />
        </Button>
      </div>
      <MealContents meal={meal} />
    </article>
  );
}
