import type { ReactNode } from "react";
import { useSearchParams } from "react-router";

import { CatalogComboBox } from "../catalog/CatalogComboBox";
import { exerciseCatalog, type CatalogItem } from "../catalog/catalogs";
import { RecentChips } from "../catalog/RecentChips";
import { useToday } from "../lib/useToday";
import { labelClass, fieldClass } from "../components/formStyles";
import { Segments } from "../components/Segments";
import { DashboardSection } from "./DashboardSection";
import { ExerciseDays } from "./ExerciseDays";
import { MealDays } from "./MealDays";
import { MealFilter } from "./MealFilter";
import {
  parseHistory,
  rangeStart,
  toHistoryParams,
  type HistoryQuery,
  type RangeName,
  type Tab,
} from "./historyQuery";

const TABS = [
  { id: "meals", label: "Meals" },
  { id: "exercise", label: "Exercise" },
] as const satisfies readonly { id: Tab; label: string }[];

const RANGES = [
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "60d", label: "60 days" },
  { id: "90d", label: "90 days" },
  { id: "1y", label: "1 year" },
  { id: "all", label: "All" },
] as const satisfies readonly { id: RangeName; label: string }[];

// ADR 0033's History frame: Meals | Exercise across a full row, then the kind's
// search field with the Range beside it, the Dashboard section, then Recent Days.
// Every choice lives in the URL, so this screen holds no state of its own.
export function HistoryScreen() {
  const [params, setParams] = useSearchParams();
  const today = useToday();
  const query = parseHistory(params);
  const from = rangeStart(query.range, today);

  // Replace, not push: the phone's Back should leave History, not undo each tap.
  function update(change: Partial<HistoryQuery>) {
    setParams(toHistoryParams({ ...query, ...change }), { replace: true });
  }

  function pickExercise(item: CatalogItem | null) {
    update({ exercise: item && { id: item.id, name: item.name } });
  }

  const section = (exercise: HistoryQuery["exercise"]) => (
    <DashboardSection
      exercise={exercise}
      from={from}
      to={today}
      open={query.dash}
      onOpenChange={(dash) => {
        update({ dash });
      }}
    />
  );

  // The search field takes three quarters of the row, the Range the last quarter.
  // Both have a label above, so their boxes line up.
  const searchRow = (field: ReactNode) => (
    <div className="flex gap-2">
      <div className="min-w-0 basis-3/4">{field}</div>
      <label className={`${labelClass} basis-1/4`}>
        Range
        {/* A native select: on a phone it opens the system's own picker. */}
        <select
          value={query.range}
          onChange={(event) => {
            const range = RANGES.find(({ id }) => id === event.target.value);
            if (range) {
              update({ range: range.id });
            }
          }}
          className={`${fieldClass} px-2`}
        >
          {RANGES.map(({ id, label }) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-4">
      {/* No Back link: History is the tab's root, and the bar leaves it. */}
      <h1 className="text-xl font-semibold">History</h1>

      <Segments
        label="Kind"
        options={TABS}
        value={query.tab}
        onChange={(tab) => {
          update({ tab });
        }}
      />

      {query.tab === "meals" ? (
        <>
          {searchRow(
            <MealFilter
              value={query.q}
              onCommit={(q) => {
                update({ q });
              }}
            />,
          )}
          {/* The filter never narrows the Dashboard (ADR 0033): its numbers stay
              "all eating in the Range". */}
          {section(null)}
          {/* Keyed on the Range and the filter, so each new list starts with its
              newest Day open, like a first visit. */}
          <MealDays
            key={`${from ?? "all"} ${query.q}`}
            from={from}
            to={today}
            q={query.q}
          />
        </>
      ) : (
        <>
          {/* Read-only: History never creates an Exercise, and an archived one
              still has history worth charting. */}
          {searchRow(
            <CatalogComboBox
              catalog={exerciseCatalog}
              canCreate={false}
              clearable
              value={query.exercise && { ...query.exercise, archived: false }}
              onChange={pickExercise}
            />,
          )}
          {/* The pick is required (ADR 0033): with no `id` in the URL, the
              screen is this empty state and asks the API for no Sessions. */}
          {query.exercise === null ? (
            <>
              <RecentChips
                catalog={exerciseCatalog}
                title="Recent"
                includeArchived
                onPick={pickExercise}
              />
              <p className="mt-6 text-center text-gray-600">
                Pick an Exercise to see its Sessions.
              </p>
            </>
          ) : (
            <>
              {section(query.exercise)}
              {/* Keyed like Meals, and per Exercise too, so a new pick starts
                  with its own newest Day open. */}
              <ExerciseDays
                key={`${query.exercise.id} ${from ?? "all"}`}
                exerciseId={query.exercise.id}
                from={from}
                to={today}
              />
            </>
          )}
        </>
      )}
    </main>
  );
}
