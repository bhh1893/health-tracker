import { useInfiniteQuery } from "@tanstack/react-query";

import { api, unwrap } from "../api/client";
import type { components } from "../api/schema";

export type MealDay = components["schemas"]["MealDay"];
type MealDayPage = components["schemas"]["MealDayPage"];

// Every Meal write and Food write marks these stale, since any of them can change
// what a Day lists.
export const MEAL_DAYS_KEY = "meal-days";

// Days per request. The API's default, written out so a test can count on it.
export const DAYS_PER_PAGE = 20;

// Days with Meals from `from` to `to`, newest first, a page at a time. A null
// `from` means all of history. pageParam is the cursor (ADR 0006): null for the
// first page, then each page's opaque next_cursor; a null next_cursor ends the
// list. A new range is a new key, so it starts over from the first page.
export function useMealDays(from: string | null, to: string) {
  return useInfiniteQuery({
    queryKey: [MEAL_DAYS_KEY, from, to],
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET("/api/v1/meal-days", {
          params: {
            query: { from, to, cursor: pageParam, limit: DAYS_PER_PAGE },
          },
        }),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last: MealDayPage) => last.next_cursor,
  });
}
