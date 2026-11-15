import { Link, useLocation, useSearchParams } from "react-router";

import { CatalogComboBox } from "../catalog/CatalogComboBox";
import { exerciseCatalog } from "../catalog/catalogs";
import { backTarget } from "../lib/backTarget";
import { useToday } from "../lib/useToday";
import { Segments } from "../search/Segments";
import {
  parseDashboard,
  rangeStart,
  toDashboardParams,
  type DashboardQuery,
  type RangeName,
  type Tab,
} from "./dashboardQuery";
import { ExerciseDashboard } from "./ExerciseDashboard";
import { MealsDashboard } from "./MealsDashboard";

const TABS = [
  { id: "exercise", label: "Exercise" },
  { id: "meals", label: "Meals" },
] as const satisfies readonly { id: Tab; label: string }[];

const RANGES = [
  { id: "30d", label: "30 days" },
  { id: "60d", label: "60 days" },
  { id: "90d", label: "90 days" },
  { id: "1y", label: "1 year" },
  { id: "all", label: "All" },
] as const satisfies readonly { id: RangeName; label: string }[];

// ADR 0024: "how is it trending?", where Search answers "what happened?". Split
// into Exercise and Meals like the logging windows. Every choice lives in the URL,
// so this screen holds no state of its own.
export default function DashboardsScreen() {
  const [params, setParams] = useSearchParams();
  // location.state is `any`: whatever a link chose to pass. Read it as unknown.
  const state: unknown = useLocation().state;
  const today = useToday();
  const query = parseDashboard(params);
  const from = rangeStart(query.range, today);

  // Replace, not push: Back should leave Dashboards, not undo each chip tap. The
  // state is passed on, or the Back link would forget where it leads.
  function update(change: Partial<DashboardQuery>) {
    setParams(toDashboardParams({ ...query, ...change }), {
      replace: true,
      state,
    });
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-4">
      <header className="flex items-center gap-4">
        <Link className="text-teal-700 underline" to={backTarget(state)}>
          Back
        </Link>
        <h1 className="text-xl font-semibold">Dashboards</h1>
      </header>

      <Segments
        label="Dashboard"
        options={TABS}
        value={query.tab}
        onChange={(tab) => {
          update({ tab });
        }}
      />
      <Segments
        label="Range"
        options={RANGES}
        value={query.range}
        onChange={(range) => {
          update({ range });
        }}
      />

      {query.tab === "meals" ? (
        <MealsDashboard from={from} to={today} />
      ) : (
        <>
          {/* Read-only, as on Search: a dashboard never creates an Exercise, and an
              archived one still has history worth charting. */}
          <CatalogComboBox
            catalog={exerciseCatalog}
            canCreate={false}
            value={query.exercise && { ...query.exercise, archived: false }}
            onChange={(item) => {
              update({ exercise: item && { id: item.id, name: item.name } });
            }}
          />
          {query.exercise === null ? (
            <p className="text-gray-500">
              Pick an Exercise to see its progress.
            </p>
          ) : (
            <ExerciseDashboard
              // Remounted per Exercise, so one's chart never shows under another's name.
              key={query.exercise.id}
              exerciseId={query.exercise.id}
              from={from}
              to={today}
            />
          )}
        </>
      )}
    </main>
  );
}
