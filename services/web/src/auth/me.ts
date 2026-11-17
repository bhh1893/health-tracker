import { useQuery } from "@tanstack/react-query";

import { api, unwrap } from "../api/client";

// One cache entry for the signed-in User: the app shell reads the Role from it and
// Dashboards reads the Restaurant Day calories, so neither asks twice.
export const ME_KEY = ["me"];

export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: () => unwrap(api.GET("/api/me")),
  });
}
