import {
  Button,
  Disclosure,
  DisclosurePanel,
  Heading,
} from "react-aria-components";

import { Chevron } from "../components/Chevron";
import { LoadMore } from "../components/LoadMore";
import { ProblemAlert } from "../components/ProblemAlert";
import { formatAmount } from "../meals/meals";
import { formatDayTitle } from "./dayTitle";
import { useMealDays, type MealDay } from "./queries";

const buttonClass =
  "m-3 rounded-xl border-2 border-teal-700 p-3 text-base text-teal-700 data-pressed:bg-teal-50";

// ADR 0033's Recent Days on Meals: every Day in the Range with a Meal, newest
// first, one row each, loaded a page at a time as the list nears its end.
export function RecentDays({ from, to }: { from: string | null; to: string }) {
  const pages = useMealDays(from, to);
  const days = pages.data?.pages.flatMap((page) => page.items) ?? [];
  const { error, hasNextPage, isFetchingNextPage } = pages;

  return (
    <section
      aria-labelledby="recent-days"
      className="flex flex-col rounded-2xl border border-gray-200 bg-white"
    >
      <h2
        id="recent-days"
        className="px-3 pt-3 pb-1 text-sm font-semibold text-gray-600"
      >
        Recent Days
      </h2>
      {days.map((day, index) => (
        // Which rows are open is not kept in the URL (ADR 0033): opening a Day
        // is a quick look, not a setting.
        <DayRow key={day.day} day={day} defaultExpanded={index === 0} />
      ))}
      {!pages.isPending && error === null && days.length === 0 && (
        <p className="px-3 pb-3 text-gray-500">No Meals in this range.</p>
      )}
      <Status
        pages={pages.data?.pages}
        isPending={pages.isPending}
        isFetchingNextPage={isFetchingNextPage}
        hasNextPage={hasNextPage}
      />
      {error !== null && (
        <div className="flex flex-col px-3 pb-3">
          <ProblemAlert error={error} />
          <Button
            className={buttonClass}
            // The first page failed, or a later one: read the one that did.
            onPress={() =>
              void (pages.data === undefined
                ? pages.refetch()
                : pages.fetchNextPage())
            }
          >
            Try again
          </Button>
        </div>
      )}
      {/* Unmounted while a page is in flight, so it remounts after each load and
          asks again if the end is still in view. Gone on an error, so a failing
          page is not asked for in a loop. */}
      {hasNextPage && !isFetchingNextPage && error === null && (
        <LoadMore
          className={buttonClass}
          onShow={() => {
            // cancelRefetch: false, so a second call while a page is in flight
            // is a no-op instead of restarting that request.
            void pages.fetchNextPage({ cancelRefetch: false });
          }}
        />
      )}
    </section>
  );
}

interface StatusProps {
  pages: { items: MealDay[] }[] | undefined;
  isPending: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
}

// One live region, always in the page. A screen reader speaks a live region's
// text when it changes, but only if the region was already there: one that
// mounts with its text already in it is often missed. role="status" is polite, so
// it waits until the reader finishes what it is saying.
function Status({
  pages,
  isPending,
  isFetchingNextPage,
  hasNextPage,
}: StatusProps) {
  let text = "";
  let visible = true;
  if (isPending) {
    text = "Loading...";
  } else if (isFetchingNextPage) {
    text = "Loading more...";
  } else if (pages !== undefined && pages.length > 1) {
    // Said, not shown: the new rows are on the screen already.
    const added = pages.at(-1)?.items.length ?? 0;
    text = hasNextPage
      ? `Loaded ${String(added)} more Days.`
      : `Loaded ${String(added)} more Days, the last in this range.`;
    visible = false;
  }
  return (
    <p
      role="status"
      className={visible && text !== "" ? "px-3 pb-3 text-gray-500" : "sr-only"}
    >
      {text}
    </p>
  );
}

function DayRow({
  day,
  defaultExpanded,
}: {
  day: MealDay;
  defaultExpanded: boolean;
}) {
  const title = formatDayTitle(day.day);
  // A Restaurant Day is any Day with a Restaurant Meal (ADR 0023).
  const ateOut = day.meals.some((meal) => meal.kind === "restaurant");
  return (
    <Disclosure
      defaultExpanded={defaultExpanded}
      className="group border-t border-gray-100"
    >
      <Heading level={3}>
        <Button
          slot="trigger"
          // Spoken as "11-13-26 [Friday], Ate out": the spans alone would run
          // together.
          aria-label={ateOut ? `${title}, Ate out` : title}
          className="flex min-h-11 w-full items-center gap-2 px-3 text-left font-semibold"
        >
          <span>{title}</span>
          {ateOut && (
            <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-800">
              Ate out
            </span>
          )}
          <span className="ml-auto">
            <Chevron />
          </span>
        </Button>
      </Heading>
      <DisclosurePanel>
        <ul className="px-3 pb-2">
          {day.meals.flatMap((meal) =>
            meal.kind === "restaurant" ? (
              <li
                key={meal.id}
                className="flex items-center gap-2 py-1.5 text-orange-800"
              >
                <ForkKnifeIcon />
                {meal.restaurant.name}
              </li>
            ) : (
              meal.food_entries.map((entry, index) => (
                <li
                  // A Meal may hold the same Food twice, so the Food id cannot
                  // be the key.
                  key={`${meal.id}-${String(index)}`}
                  className="flex justify-between gap-3 py-1.5"
                >
                  <span>{entry.food.name}</span>
                  <span className="whitespace-nowrap text-gray-600">
                    {formatAmount(entry)}
                  </span>
                </li>
              ))
            ),
          )}
        </ul>
      </DisclosurePanel>
    </Disclosure>
  );
}

function ForkKnifeIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 3v8M5 3v4a2 2 0 0 0 4 0V3M7 11v10M17 21V3c-2 1-3 4-3 8h3" />
    </svg>
  );
}
