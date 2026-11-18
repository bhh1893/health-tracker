import { useInfiniteQuery } from "@tanstack/react-query";

import { api, unwrap } from "../api/client";
import type { components } from "../api/schema";
import type { ExerciseSession } from "../exercise/sessions";

export type MealDay = components["schemas"]["MealDay"];
type MealDayPage = components["schemas"]["MealDayPage"];

// One page of Recent Days, whatever a Day holds. next_cursor is opaque to the
// list: null ends it, anything else is handed back to ask for the next page.
export interface DayPage<T> {
  items: T[];
  next_cursor: string | null;
}

// Every Meal write and Food write marks these stale, since any of them can change
// what a Day lists.
export const MEAL_DAYS_KEY = "meal-days";

// Every Set write marks these stale, for the same reason.
export const EXERCISE_DAYS_KEY = "exercise-days";

// Days per request. The API's default, written out so a test can count on it.
export const DAYS_PER_PAGE = 20;

// Days with Meals from `from` to `to`, newest first, a page at a time. A null
// `from` means all of history. pageParam is the cursor (ADR 0006): null for the
// first page, then each page's opaque next_cursor; a null next_cursor ends the
// list. A new range is a new key, so it starts over from the first page.
//
// `q` keeps only the Days with a Food or Restaurant whose name contains it. The
// server filters, not the browser: with paging, the browser only ever holds the
// pages loaded so far and would miss older matches (ADR 0033). Each `q` is its own
// key, so it is cached on its own and starts from the first page too.
export function useMealDays(from: string | null, to: string, q: string) {
  return useInfiniteQuery({
    queryKey: [MEAL_DAYS_KEY, from, to, q],
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET("/api/v1/meal-days", {
          params: {
            query: {
              from,
              to,
              // Left out when empty, so no filter is no `q` at all.
              ...(q === "" ? {} : { q }),
              cursor: pageParam,
              limit: DAYS_PER_PAGE,
            },
          },
        }),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last: MealDayPage) => last.next_cursor,
  });
}

// One Exercise's Sessions from `from` to `to`, newest first, a page at a time
// (ADR 0033). The same GET /exercises/{id}/sessions the Dashboard reads, but the
// Dashboard needs the whole range at once to chart it, and this list must not.
//
// The endpoint has no cursor: it pages by `to` (ADR 0024). Asking for one Session
// more than a page tells whether another page exists. That extra Session is not
// shown; its Day becomes the next page's `to`, so the next page starts with it,
// and the end of the list never costs an empty request.
export function useExerciseDays(
  exerciseId: string,
  from: string | null,
  to: string,
) {
  return useInfiniteQuery({
    queryKey: [EXERCISE_DAYS_KEY, exerciseId, from, to],
    queryFn: async ({ pageParam }): Promise<DayPage<ExerciseSession>> => {
      const sessions = await unwrap(
        api.GET("/api/v1/exercises/{exercise_id}/sessions", {
          params: {
            path: { exercise_id: exerciseId },
            query: { from, to: pageParam ?? to, limit: DAYS_PER_PAGE + 1 },
          },
        }),
      );
      return {
        items: sessions.slice(0, DAYS_PER_PAGE),
        next_cursor: sessions[DAYS_PER_PAGE]?.day ?? null,
      };
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
  });
}
