import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import { api, unwrap } from "../api/client";
import { foodCatalog } from "../catalog/catalogs";
import { itemKey } from "../catalog/queries";
import { MEAL_WRITES_KEY } from "../meals/queries";
import { DAY_TOTALS_KEY } from "../nutrition/queries";
import type { Food, PatchFood, PutFood } from "./foodForm";

const REFERENCE_LIMIT = 10;
// Under the Foods Catalog's prefix, so an Archive from Profile refreshes it too.
const foodKey = (id: string) => itemKey(foodCatalog, id);

// The whole Food, with Nutrition. A Meal only embeds its name, so the sheet reads it.
export function useFood(id: string) {
  return useQuery({
    queryKey: foodKey(id),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/foods/{item_id}", {
          params: { path: { item_id: id } },
        }),
      ),
  });
}

export function useReferenceFoods(q: string) {
  return useQuery({
    // Keyed on q, so a slow answer for "oa" never replaces the one for "oats".
    queryKey: ["reference-foods", q],
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/reference-foods", {
          params: { query: { q, limit: REFERENCE_LIMIT } },
        }),
      ),
  });
}

// A Food's name shows in every Meal and Search result that holds it, and its
// Nutrition feeds every total (ADR 0023: computed on read, so past Days change too).
function refreshAfterFoodWrite(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: [foodCatalog.key] });
  void queryClient.invalidateQueries({ queryKey: [DAY_TOTALS_KEY] });
  void queryClient.invalidateQueries({ queryKey: ["search"] });
  // A Meal write still in flight refetches its own Day when it settles. Refetching
  // now could briefly drop its optimistic Meal, so only mark the Days stale.
  const mealWritePending =
    queryClient.isMutating({ mutationKey: MEAL_WRITES_KEY }) > 0;
  void queryClient.invalidateQueries({
    queryKey: ["meals"],
    refetchType: mealWritePending ? "none" : "active",
  });
}

export function usePatchFood(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: PatchFood) =>
      unwrap(
        api.PATCH("/api/v1/foods/{item_id}", {
          params: { path: { item_id: id } },
          body,
        }),
      ),
    onSuccess: (food: Food) => {
      queryClient.setQueryData(foodKey(id), food);
      refreshAfterFoodWrite(queryClient);
    },
  });
}

// The "+" sheet on Profile's Foods page: one PUT with a client-made id, the same
// create path logging uses, so a retry or "Save anyway" writes the same Food.
export function usePutFood(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: PutFood) =>
      unwrap(
        api.PUT("/api/v1/foods/{item_id}", {
          params: { path: { item_id: id } },
          body,
        }),
      ),
    onSuccess: (food: Food) => {
      queryClient.setQueryData(foodKey(id), food);
      refreshAfterFoodWrite(queryClient);
    },
  });
}
