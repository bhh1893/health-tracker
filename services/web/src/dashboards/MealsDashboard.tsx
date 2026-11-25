import { ProblemAlert } from "../components/ProblemAlert";
import { useDayTotals } from "../nutrition/queries";
import { formatKcal, formatMacros } from "../nutrition/totals";
import { StatTiles } from "./StatTiles";
import { historyStart, summarizeMeals } from "./stats";
import { TrendChart } from "./TrendChart";

interface MealsDashboardProps {
  // Null means all of history.
  from: string | null;
  to: string;
}

// Calories per Day (ADR 0024), from GET /days. A Restaurant Day is a pink point
// on the line at the User's flat value (ADR 0033). An Incomplete Day is a ring: it
// under-reports. The flat value is set on Profile (ADR 0032).
export function MealsDashboard({ from, to }: MealsDashboardProps) {
  const totals = useDayTotals(from, to);

  return (
    <>
      {totals.error && <ProblemAlert error={totals.error} />}
      {totals.data === undefined && !totals.error && (
        <p role="status" className="text-faint">
          Loading...
        </p>
      )}
      {totals.data?.length === 0 && (
        <p className="text-faint">No Meals in this range.</p>
      )}
      {totals.data !== undefined && totals.data.length > 0 && (
        <Charts totals={totals.data} from={from} to={to} />
      )}
    </>
  );
}

function Charts({
  totals,
  from,
  to,
}: MealsDashboardProps & {
  totals: NonNullable<ReturnType<typeof useDayTotals>["data"]>;
}) {
  const summary = summarizeMeals(totals);
  const start =
    from ??
    historyStart(
      totals.map((total) => total.day),
      to,
    );
  return (
    <>
      <TrendChart
        title="Calories per Day"
        measures="food"
        from={start}
        to={to}
        fromZero
        formatValue={formatKcal}
        accentLabel="ate out"
        hollowLabel="incomplete"
        // The API answers newest first; a chart reads oldest first.
        points={totals.toReversed().map((total) => ({
          day: total.day,
          value: total.kcal,
          accent: total.restaurant_day,
          hollow: total.incomplete,
          detail: formatMacros(total) ?? undefined,
        }))}
      />
      <StatTiles
        stats={[
          {
            label: "avg",
            value:
              summary.averageKcal === null
                ? "–"
                : formatKcal(summary.averageKcal),
            note: `${String(summary.days)} ${summary.days === 1 ? "day" : "days"}`,
          },
          {
            label: "ate out",
            value: String(summary.restaurantDays),
          },
          {
            label: "incomplete",
            value: String(summary.incompleteDays),
          },
        ]}
      />
    </>
  );
}
