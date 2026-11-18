import { useMe } from "../auth/me";
import { ProblemAlert } from "../components/ProblemAlert";
import { useDayTotals } from "../nutrition/queries";
import { formatKcal, formatMacros } from "../nutrition/totals";
import { RestaurantDaySetting } from "./RestaurantDaySetting";
import { StatTiles } from "./StatTiles";
import { historyStart, summarizeMeals } from "./stats";
import { TrendChart } from "./TrendChart";

interface MealsDashboardProps {
  // Null means all of history.
  from: string | null;
  to: string;
}

// Calories per Day (ADR 0024), from GET /days. A Restaurant Day is an orange point
// on the line at the User's flat value (ADR 0033). An Incomplete Day is a ring: it
// under-reports.
export function MealsDashboard({ from, to }: MealsDashboardProps) {
  const totals = useDayTotals(from, to);
  const me = useMe();

  return (
    <>
      {totals.error && <ProblemAlert error={totals.error} />}
      {totals.data === undefined && !totals.error && (
        <p role="status" className="text-gray-500">
          Loading...
        </p>
      )}
      {totals.data?.length === 0 && (
        <p className="text-gray-500">No Meals in this range.</p>
      )}
      {totals.data !== undefined && totals.data.length > 0 && (
        <Charts totals={totals.data} from={from} to={to} />
      )}
      {me.error && <ProblemAlert error={me.error} />}
      {me.data && (
        <RestaurantDaySetting
          // Remounted when the saved value changes, so the field follows it.
          key={me.data.restaurant_day_kcal}
          saved={me.data.restaurant_day_kcal}
        />
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
      <StatTiles
        stats={[
          {
            label: "Average",
            value:
              summary.averageKcal === null
                ? "–"
                : formatKcal(summary.averageKcal),
            note: `over ${String(summary.days)} logged ${summary.days === 1 ? "Day" : "Days"}`,
          },
          {
            label: "Restaurant Days",
            value: String(summary.restaurantDays),
          },
          {
            label: "Incomplete Days",
            value: String(summary.incompleteDays),
          },
        ]}
      />
      <TrendChart
        title="Calories per Day"
        from={start}
        to={to}
        fromZero
        formatValue={formatKcal}
        accentLabel="Restaurant Day"
        hollowLabel="Incomplete Day"
        // The API answers newest first; a chart reads oldest first.
        points={totals.toReversed().map((total) => ({
          day: total.day,
          value: total.kcal,
          accent: total.restaurant_day,
          hollow: total.incomplete,
          detail: formatMacros(total) ?? undefined,
        }))}
      />
    </>
  );
}
