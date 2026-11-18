import { useSearchParams } from "react-router";

import { CatalogComboBox } from "../catalog/CatalogComboBox";
import { exerciseCatalog } from "../catalog/catalogs";
import { useToday } from "../lib/useToday";
import { Segments } from "../search/Segments";
import { DashboardSection } from "./DashboardSection";
import { RecentDays } from "./RecentDays";
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
  { id: "30d", label: "30 days" },
  { id: "60d", label: "60 days" },
  { id: "90d", label: "90 days" },
  { id: "1y", label: "1 year" },
  { id: "all", label: "All" },
] as const satisfies readonly { id: RangeName; label: string }[];

// ADR 0033's History frame: Meals | Exercise and the Range on one row, then the
// Dashboard section, then Recent Days. Every choice lives in the URL, so this
// screen holds no state of its own.
export function HistoryScreen() {
  const [params, setParams] = useSearchParams();
  const today = useToday();
  const query = parseHistory(params);
  const from = rangeStart(query.range, today);

  // Replace, not push: the phone's Back should leave History, not undo each tap.
  function update(change: Partial<HistoryQuery>) {
    setParams(toHistoryParams({ ...query, ...change }), { replace: true });
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

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-4">
      {/* No Back link: History is the tab's root, and the bar leaves it. */}
      <h1 className="text-xl font-semibold">History</h1>

      <div className="flex items-center justify-between gap-2">
        <Segments
          label="Kind"
          options={TABS}
          value={query.tab}
          onChange={(tab) => {
            update({ tab });
          }}
        />
        {/* A native select: on a phone it opens the system's own picker. */}
        <select
          aria-label="Range"
          value={query.range}
          onChange={(event) => {
            const range = RANGES.find(({ id }) => id === event.target.value);
            if (range) {
              update({ range: range.id });
            }
          }}
          className="rounded-full border border-gray-300 bg-white px-3 py-1 text-base"
        >
          {RANGES.map(({ id, label }) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {query.tab === "meals" ? (
        <>
          {section(null)}
          {/* Keyed on the Range, so a new Range also starts with its newest Day
              open, like a first visit. */}
          <RecentDays key={from ?? "all"} from={from} to={today} />
        </>
      ) : (
        <>
          {/* Read-only: History never creates an Exercise, and an archived one
              still has history worth charting. */}
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
            section(query.exercise)
          )}
        </>
      )}
    </main>
  );
}
