import { lazy, Suspense } from "react";
import {
  Button,
  Disclosure,
  DisclosurePanel,
  Heading,
} from "react-aria-components";

import { summarizeMeals } from "../dashboards/stats";
import { useDayTotals } from "../nutrition/queries";
import { formatKcal } from "../nutrition/totals";
import type { Picked } from "../search/searchQuery";
import { loadDashboard } from "./loadDashboard";

// React.lazy calls loadDashboard on the first render of <Dashboard>, which
// happens only once the section is open, and suspends until the chunk arrives.
const Dashboard = lazy(loadDashboard);

interface DashboardSectionProps {
  // The picked Exercise, or null for Meals.
  exercise: Picked | null;
  from: string | null;
  to: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ADR 0033's Dashboard section: a row that opens to ADR 0024's tiles and charts.
// Closed by default; whether it is open lives in the URL, so the parent owns it.
export function DashboardSection({
  exercise,
  from,
  to,
  open,
  onOpenChange,
}: DashboardSectionProps) {
  const hint = useHint(exercise, from, to);

  return (
    <Disclosure
      isExpanded={open}
      onExpandedChange={onOpenChange}
      className="group rounded-2xl border border-gray-200 bg-white"
    >
      <Heading level={2}>
        <Button
          slot="trigger"
          // Spoken as "Dashboard, Avg 2,000 kcal": the spans alone would run
          // together.
          aria-label={hint === null ? "Dashboard" : `Dashboard, ${hint}`}
          className="flex w-full items-center gap-2 p-3 text-left"
        >
          <ChartIcon />
          <span className="font-semibold">Dashboard</span>
          <span className="ml-auto truncate text-sm text-gray-600">{hint}</span>
          <Chevron />
        </Button>
      </Heading>
      <DisclosurePanel className="flex flex-col gap-4 px-3 pb-3">
        {/* Rendered only while open. DisclosurePanel keeps its children mounted
            (hidden) when closed, which would load the chunk on History's first
            visit. */}
        {open && (
          <Suspense
            fallback={
              <p role="status" className="text-gray-500">
                Loading...
              </p>
            }
          >
            <Dashboard exercise={exercise} from={from} to={to} />
          </Suspense>
        )}
      </DisclosurePanel>
    </Disclosure>
  );
}

// What the closed row tells you without opening it: the Range's average on
// Meals, the picked Exercise on Exercise. The Meals average reads the same GET
// /days query the opened dashboard reads, so opening reuses the cached answer.
function useHint(exercise: Picked | null, from: string | null, to: string) {
  const totals = useDayTotals(from, to, exercise === null);
  if (exercise !== null) {
    return exercise.name;
  }
  const average =
    totals.data === undefined ? null : summarizeMeals(totals.data).averageKcal;
  return average === null ? null : `Avg ${formatKcal(average)}`;
}

function ChartIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5 shrink-0 text-teal-700"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 20V4M4 20h16" />
      <path d="m7 15 4-4 3 3 5-6" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      // Points down when closed and up when open. The Disclosure carries
      // data-expanded; `group` lets this child read it.
      className="size-5 shrink-0 text-gray-500 transition-transform group-data-expanded:rotate-180"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
