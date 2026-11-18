import type {
  InfiniteData,
  UseInfiniteQueryResult,
} from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  Button,
  Disclosure,
  DisclosurePanel,
  Heading,
} from "react-aria-components";

import { Chevron } from "../components/Chevron";
import { LoadMore } from "../components/LoadMore";
import { ProblemAlert } from "../components/ProblemAlert";
import { formatDayTitle } from "./dayTitle";
import type { DayPage } from "./queries";

const buttonClass =
  "m-3 rounded-xl border-2 border-teal-700 p-3 text-base text-teal-700 data-pressed:bg-teal-50";

interface RecentDaysProps<T> {
  pages: UseInfiniteQueryResult<InfiniteData<DayPage<T>>>;
  // Said when the Range has no Day, e.g. "No Meals in this range."
  empty: string;
  // One row per Day, usually a <DayRow>. The newest row starts open.
  renderDay: (item: T, defaultExpanded: boolean) => ReactNode;
}

// ADR 0033's Recent Days, for either kind: the Days in the Range, newest first,
// one row each, loaded a page at a time as the list nears its end. The kind
// supplies the pages and how a Day looks; this owns the paging, the status and
// the retry, so both kinds load, announce and fail the same way.
export function RecentDays<T>({ pages, empty, renderDay }: RecentDaysProps<T>) {
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
      {/* Which rows are open is not kept in the URL (ADR 0033): opening a Day
          is a quick look, not a setting. */}
      {days.map((day, index) => renderDay(day, index === 0))}
      {!pages.isPending && error === null && days.length === 0 && (
        <p className="px-3 pb-3 text-gray-500">{empty}</p>
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
  pages: { items: unknown[] }[] | undefined;
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

interface DayRowProps {
  day: string;
  defaultExpanded: boolean;
  // An orange pill after the title, e.g. "Ate out" on a Restaurant Day.
  pill?: string | undefined;
  children: ReactNode;
}

// One Day of Recent Days: its title, which opens to the Day's contents.
export function DayRow({ day, defaultExpanded, pill, children }: DayRowProps) {
  const title = formatDayTitle(day);
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
          aria-label={pill === undefined ? title : `${title}, ${pill}`}
          className="flex min-h-11 w-full items-center gap-2 px-3 text-left font-semibold"
        >
          <span>{title}</span>
          {pill !== undefined && (
            <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-800">
              {pill}
            </span>
          )}
          <span className="ml-auto">
            <Chevron />
          </span>
        </Button>
      </Heading>
      <DisclosurePanel>{children}</DisclosurePanel>
    </Disclosure>
  );
}
