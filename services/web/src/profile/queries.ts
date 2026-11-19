import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "../api/client";
import { ME_KEY } from "../auth/me";
import { DAY_TOTALS_KEY } from "../nutrition/queries";

// Profile's Settings write the User's own row through PATCH /api/me (ADR 0032).
export function useSetRestaurantDayKcal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (kcal: number) =>
      unwrap(api.PATCH("/api/me", { body: { restaurant_day_kcal: kcal } })),
    onSuccess: (me) => {
      queryClient.setQueryData(ME_KEY, me);
      // The server computes Day Totals on read, so every past Restaurant Day just
      // changed (ADR 0023). Drop what is cached, so History and the Day total read
      // them again on their next visit.
      return queryClient.invalidateQueries({ queryKey: [DAY_TOTALS_KEY] });
    },
  });
}
