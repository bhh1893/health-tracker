import { Button } from "react-aria-components";

import { LoadMore } from "../components/LoadMore";
import { ProblemAlert } from "../components/ProblemAlert";
import { useDayTotals } from "../nutrition/queries";
import { DayRow } from "./DayRow";
import { useSearchDays } from "./queries";
import type { SearchQuery } from "./searchQuery";

const buttonClass =
  "rounded-xl border-2 border-teal-700 p-3 text-base text-teal-700 data-pressed:bg-teal-50";

// Day rows for a range question, newest first, loaded a screen at a time.
export function DayResults({ query }: { query: SearchQuery }) {
  const { days, error, isLoading, hasMore, showMore, retry } =
    useSearchDays(query);
  // One summary request for the range, beside the paged Entries: the server owns the
  // Restaurant Day and Incomplete Day rules (ADR 0023). An Exercise question reads
  // no Meals, so it has no totals to show.
  const totals = useDayTotals(query.from, query.to, query.what !== "exercise");
  const totalOf = new Map(totals.data?.map((total) => [total.day, total]));

  return (
    <section aria-label="Results" className="flex flex-col gap-2">
      {days.map((result) => (
        <DayRow
          key={result.day}
          result={result}
          total={result.meals.length > 0 ? totalOf.get(result.day) : undefined}
        />
      ))}
      {!isLoading && !hasMore && error === null && days.length === 0 && (
        <p className="text-gray-500">Nothing logged in this range.</p>
      )}
      {/* The rows are still right without totals, so this failure does not replace them. */}
      {totals.error !== null && <ProblemAlert error={totals.error} />}
      {error !== null && (
        <>
          <ProblemAlert error={error} />
          <Button className={buttonClass} onPress={retry}>
            Try again
          </Button>
        </>
      )}
      {isLoading && error === null && (
        <p role="status" className="text-gray-500">
          Loading...
        </p>
      )}
      {!isLoading && hasMore && error === null && (
        <LoadMore onShow={showMore} className={buttonClass} />
      )}
    </section>
  );
}
