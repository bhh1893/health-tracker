import {
  formatKcal,
  formatMacros,
  type DayTotal,
  type MealTotal,
} from "./totals";

const lineClass = "text-sm text-gray-600";

// One Meal's calories and macros. Nothing counted at all reads as "no Nutrition
// yet", not as a Meal of 0 kcal.
export function MealTotalLine({ total }: { total: MealTotal }) {
  if (total.incomplete && total.kcal === 0) {
    return <p className={lineClass}>No Nutrition yet</p>;
  }
  return (
    <p className={lineClass}>
      {formatKcal(total.kcal)} · {formatMacros(total)}
      {total.incomplete && " · incomplete"}
    </p>
  );
}

// The whole Day's calories and macros, with the two cases where the number is not
// a plain sum spelled out (ADR 0023).
export function DayTotalLine({ total }: { total: DayTotal }) {
  const macros = formatMacros(total);
  return (
    <div className="rounded-xl bg-gray-50 p-3">
      <p className="font-semibold">
        Day total: {formatKcal(total.kcal)}
        {macros !== null && (
          <span className="font-normal text-gray-600"> · {macros}</span>
        )}
      </p>
      {total.restaurant_day && (
        <p className={lineClass}>
          Restaurant Day: counted at your flat value, whatever else was logged.
        </p>
      )}
      {total.incomplete && (
        <p className={lineClass}>
          Incomplete: some Foods have no Nutrition or Piece Weight, so the real
          total is higher.
        </p>
      )}
    </div>
  );
}
