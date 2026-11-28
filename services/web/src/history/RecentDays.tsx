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
import { Link } from "react-router";

import {
  categoryName,
  type RestaurantCategory,
} from "../catalog/restaurantCategory";
import { CategoryIcon } from "../components/CategoryIcon";
import { Chevron } from "../components/Chevron";
import { LoadMore } from "../components/LoadMore";
import { ProblemAlert } from "../components/ProblemAlert";
import { formatDayTitle } from "./dayTitle";
import type { DayPage } from "./queries";

const buttonClass =
  "m-3 rounded-xl border-2 border-action p-3 text-base text-action-ink data-pressed:bg-action-soft";

interface RecentDaysProps<T> {
  pages: UseInfiniteQueryResult<InfiniteData<DayPage<T>>>;
  // Said when the Range has no Day, e.g. "No Meals in this range."
  empty: string;
  // A line at the top of the list about the Days listed, e.g. how many match a filter.
  summary?: string | undefined;
  // One row per Day, usually a <DayRow>. Every row starts closed.
  renderDay: (item: T) => ReactNode;
}

// ADR 0033's Recent Days, for either kind: the Days in the Range, newest first,
// one row each, loaded a page at a time as the list nears its end. The kind
// supplies the pages and how a Day looks; this owns the paging, the status and
// the retry, so both kinds load, announce and fail the same way.
export function RecentDays<T>({
  pages,
  empty,
  summary,
  renderDay,
}: RecentDaysProps<T>) {
  const days = pages.data?.pages.flatMap((page) => page.items) ?? [];
  const { error, hasNextPage, isFetchingNextPage } = pages;

  return (
    // No visible title: the heavier border sets the list apart. The region keeps
    // a name for screen readers, which list it among the page's landmarks.
    <section
      aria-label="Days"
      // overflow-hidden clips the filled Day rows to the card's rounded corners.
      className="flex flex-col overflow-hidden rounded-2xl border-2 border-field bg-card"
    >
      {summary !== undefined && (
        <p className="px-3 py-2 text-sm text-muted">{summary}</p>
      )}
      {/* Which rows are open is not kept in the URL (ADR 0033): opening a Day
          is a quick look, not a setting. */}
      {days.map(renderDay)}
      {!pages.isPending && error === null && days.length === 0 && (
        <p className="px-3 py-3 text-faint">{empty}</p>
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
      className={visible && text !== "" ? "px-3 py-3 text-faint" : "sr-only"}
    >
      {text}
    </p>
  );
}

interface DayRowProps {
  day: string;
  // The Home window the arrow opens the Day in: "/meals" or "/exercise".
  homePath: "/meals" | "/exercise";
  // On a Restaurant Day, its Restaurants' Categories (ADR 0041): each drawn as its
  // icon after the title, and read out after it, e.g. "ate out, drinks".
  categories?: readonly RestaurantCategory[];
  children: ReactNode;
}

// One Day of Recent Days: a pink title row, which opens to the Day's contents
// on white, beside a round brown arrow button to the same Day on Home, where it
// can be changed.
export function DayRow({
  day,
  homePath,
  categories = [],
  children,
}: DayRowProps) {
  const title = formatDayTitle(day);
  const spoken = [title, ...categories.map(categoryName)].join(", ");
  return (
    <Disclosure className="group border-t border-field first:border-t-0">
      {/* Level 2, a sibling of the Dashboard's heading: the list has no heading
          of its own to sit under. */}
      <Heading level={2}>
        <Button
          slot="trigger"
          // Spoken as "Friday (11/13/26), ate out": the spans alone would run
          // together. The colon is visual only, so the label leaves it out.
          aria-label={spoken}
          // -outline-offset-2 draws the focus ring inside the row, where the
          // card's overflow-hidden cannot clip it.
          className="flex min-h-11 w-full items-center gap-2 bg-restaurant px-3 text-left font-semibold text-on-restaurant -outline-offset-2 data-pressed:bg-edge"
        >
          <span>{title}:</span>
          {/* The icons carry no text: the button's label names each one. */}
          {categories.map((category) => (
            <span
              key={category}
              className="flex size-7 items-center justify-center rounded-full bg-card text-restaurant-ink"
            >
              <CategoryIcon category={category} />
            </span>
          ))}
          <span className="ml-auto">
            <Chevron className="text-on-restaurant" />
          </span>
        </Button>
      </Heading>
      <DisclosurePanel>
        <div className="flex bg-card">
          {/* min-w-0 lets a long Meal wrap instead of pushing the arrow out. */}
          <div className="min-w-0 flex-1 pt-2">{children}</div>
          {/* A plain link, not a button: it changes the URL, so long-press and
              the back button work, and Home reads the Day from ?day= (ADR 0013).
              Its own column the full height of the contents: a tall target
              that adds no row under the list. Only the round button inside
              is drawn, but a tap anywhere in the column follows the link;
              group/arrow lets the button show the column's pressed state. */}
          <Link
            to={`${homePath}?day=${day}`}
            aria-label={`Open ${title} on Home`}
            className="group/arrow flex w-14 shrink-0 items-center justify-center -outline-offset-2"
          >
            <span className="flex size-10 items-center justify-center rounded-full bg-action text-on-fill group-active/arrow:bg-action-pressed">
              <ArrowRight />
            </span>
          </Link>
        </div>
      </DisclosurePanel>
    </Disclosure>
  );
}

function ArrowRight() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-6"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14m-6-6 6 6-6 6" />
    </svg>
  );
}
