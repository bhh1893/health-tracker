import {
  useInfiniteQuery,
  useQuery,
  type UseInfiniteQueryResult,
  type InfiniteData,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { api, unwrap } from "../api/client";
import type { ExerciseEntryPage } from "../exercise/sessions";
import type { MealPage } from "../meals/meals";
import {
  laggingStream,
  wholeDays,
  type ExerciseSession,
  type Stream,
} from "./days";
import type { SearchQuery } from "./searchQuery";

// Entries per request. The API pages by Entry, not by Day: one gym Day can be 20
// Sets, so a screen of Days is reached by reading pages until enough are whole.
const PAGE_SIZE = 50;
// Day rows per screen. Scrolling to the end asks for this many more.
export const DAYS_PER_SCREEN = 15;

interface Filter {
  from: string;
  to: string;
  id: string | null;
}

// One query per collection, its pages held by TanStack Query. pageParam is the
// cursor: null for the first page, then each page's next_cursor (ADR 0006).
function useEntryPages({ from, to, id }: Filter, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ["search", "exercise-entries", from, to, id],
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET("/api/v1/exercise-entries", {
          params: {
            query: {
              from,
              to,
              exercise_id: id,
              cursor: pageParam,
              limit: PAGE_SIZE,
            },
          },
        }),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last: ExerciseEntryPage) => last.next_cursor,
    enabled,
  });
}

function useMealPages({ from, to, id }: Filter, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ["search", "meals", from, to, id],
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET("/api/v1/meals", {
          params: {
            query: {
              from,
              to,
              food_id: id,
              cursor: pageParam,
              limit: PAGE_SIZE,
            },
          },
        }),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last: MealPage) => last.next_cursor,
    enabled,
  });
}

type Pages<T> = UseInfiniteQueryResult<InfiniteData<{ items: T[] }>>;

function streamOf<T>(query: Pages<T>, enabled: boolean): Stream<T> | null {
  if (!enabled) {
    return null;
  }
  return {
    items: query.data?.pages.flatMap((page) => page.items) ?? [],
    done: query.data !== undefined && !query.hasNextPage,
  };
}

// Reading a page that failed again: the next page if some loaded, else the first.
function retry<T>(query: Pages<T>) {
  if (query.error === null) {
    return;
  }
  void (query.data === undefined ? query.refetch() : query.fetchNextPage());
}

// The Day rows for a range question. Reads pages, always from the stream holding
// Days back, until `wanted` Days are whole or both streams are done. The caller
// remounts this (key) when the question changes, so `wanted` starts over.
export function useSearchDays(query: SearchQuery) {
  const readsEntries = query.what !== "food";
  const readsMeals = query.what !== "exercise";
  const filter = { from: query.from, to: query.to, id: query.item?.id ?? null };

  const entryPages = useEntryPages(filter, readsEntries);
  const mealPages = useMealPages(filter, readsMeals);
  const [wanted, setWanted] = useState(DAYS_PER_SCREEN);

  const entries = streamOf(entryPages, readsEntries);
  const meals = streamOf(mealPages, readsMeals);
  const days = wholeDays(entries, meals);
  const next = laggingStream(entries, meals);

  const isFetching = entryPages.isFetching || mealPages.isFetching;
  const error = entryPages.error ?? mealPages.error;
  // A page is only asked for once every first page is in; until then the queries
  // are loading on their own.
  const firstPagesIn =
    (!readsEntries || entryPages.data !== undefined) &&
    (!readsMeals || mealPages.data !== undefined);
  const needsMore =
    days.length < wanted && next !== null && firstPagesIn && !isFetching;

  // Stops on an error rather than retrying in a loop; the screen offers a retry.
  useEffect(() => {
    if (!needsMore || error !== null) {
      return;
    }
    // cancelRefetch: false, so a second call while a page is in flight is a no-op
    // instead of cancelling that request and starting it again.
    const options = { cancelRefetch: false };
    void (next === "entries"
      ? entryPages.fetchNextPage(options)
      : mealPages.fetchNextPage(options));
  }, [needsMore, error, next, entryPages, mealPages]);

  return {
    days,
    error,
    isLoading: isFetching || needsMore,
    hasMore: next !== null,
    showMore: () => {
      setWanted(days.length + DAYS_PER_SCREEN);
    },
    retry: () => {
      retry(entryPages);
      retry(mealPages);
    },
  };
}

export function useLastSessions(exerciseId: string, last: number) {
  return useQuery({
    queryKey: ["search", "sessions", exerciseId, last],
    queryFn: (): Promise<ExerciseSession[]> =>
      unwrap(
        api.GET("/api/v1/exercises/{exercise_id}/sessions", {
          params: { path: { exercise_id: exerciseId }, query: { limit: last } },
        }),
      ),
  });
}
