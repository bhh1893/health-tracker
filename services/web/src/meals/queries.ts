import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import { api, unwrap } from "../api/client";
import { foodCatalog, restaurantCatalog } from "../catalog/catalogs";
import { toPutMeal, type Meal, type MealPage } from "./meals";

const MAX_PAGE_SIZE = 200;

const MEAL_WRITES_KEY = ["meal-write"];
const dayKey = (day: string) => ["meals", day];

// Writes run one at a time, in order, as for Sets: a Delete Meal sent while its PUT
// is still in flight must not reach the server first and be undone by the PUT.
const MEAL_WRITES_SCOPE = { id: "meal-writes" };

async function fetchDay(day: string) {
  const meals: Meal[] = [];
  let cursor: string | null = null;
  do {
    const page: MealPage = await unwrap(
      api.GET("/api/v1/meals", {
        params: {
          query: { from: day, to: day, limit: MAX_PAGE_SIZE, cursor },
        },
      }),
    );
    meals.push(...page.items);
    cursor = page.next_cursor;
  } while (cursor !== null);
  return meals;
}

export function useDayMeals(day: string) {
  return useQuery({ queryKey: dayKey(day), queryFn: () => fetchDay(day) });
}

function editDay(
  queryClient: QueryClient,
  day: string,
  edit: (meals: Meal[]) => Meal[],
) {
  queryClient.setQueryData<Meal[]>(
    dayKey(day),
    (meals) => meals && edit(meals),
  );
}

const without = (id: string) => (meals: Meal[]) =>
  meals.filter((meal) => meal.id !== id);

const withMeal = (meal: Meal) => (meals: Meal[]) => [
  ...without(meal.id)(meals),
  meal,
];

// Same rule as Sets: refetch only once no other write is pending, so a refetch never
// drops another write's optimistic Meal.
function refreshWhenIdle(queryClient: QueryClient, day: string) {
  if (queryClient.isMutating({ mutationKey: MEAL_WRITES_KEY }) === 1) {
    void queryClient.invalidateQueries({ queryKey: dayKey(day) });
    // A Meal changes which Foods and Restaurants are most recent, and each Food's
    // last quantity and unit (ADR 0008).
    void queryClient.invalidateQueries({ queryKey: [foodCatalog.key] });
    void queryClient.invalidateQueries({ queryKey: [restaurantCatalog.key] });
  }
}

interface MealWrite {
  // The server's version, to restore if the write fails. Null for a new Meal.
  before: Meal | null;
  after: Meal;
}

// One mutation for create and edit: both are a PUT of the whole Meal (ADR 0006).
export function usePutMeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: MEAL_WRITES_KEY,
    scope: MEAL_WRITES_SCOPE,
    mutationFn: ({ after }: MealWrite) =>
      unwrap(
        api.PUT("/api/v1/meals/{meal_id}", {
          params: { path: { meal_id: after.id } },
          body: toPutMeal(after),
        }),
      ),
    onMutate: async ({ after }) => {
      await queryClient.cancelQueries({ queryKey: dayKey(after.day) });
      editDay(queryClient, after.day, withMeal(after));
    },
    // Undoes this one write, not "restore the list as it was", which would also
    // erase another write that succeeded meanwhile.
    onError: (_error, { before, after }) => {
      editDay(
        queryClient,
        after.day,
        before === null ? without(after.id) : withMeal(before),
      );
    },
    onSettled: (_data, _error, { after }) => {
      refreshWhenIdle(queryClient, after.day);
    },
  });
}

export function useDeleteMeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: MEAL_WRITES_KEY,
    scope: MEAL_WRITES_SCOPE,
    mutationFn: (meal: Meal) =>
      unwrap(
        api.DELETE("/api/v1/meals/{meal_id}", {
          params: { path: { meal_id: meal.id } },
        }),
      ),
    onMutate: async (meal) => {
      await queryClient.cancelQueries({ queryKey: dayKey(meal.day) });
      editDay(queryClient, meal.day, without(meal.id));
    },
    onError: (_error, meal) => {
      editDay(queryClient, meal.day, withMeal(meal));
    },
    onSettled: (_data, _error, meal) => {
      refreshWhenIdle(queryClient, meal.day);
    },
  });
}
