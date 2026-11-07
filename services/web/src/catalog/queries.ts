import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { Catalog } from "./catalogs";

const SUGGESTION_LIMIT = 10;

export function useSuggestions(catalog: Catalog, q: string) {
  return useQuery({
    // q in the key means a slow answer for "ben" can never replace the one for
    // "bench": each lands in its own cache slot (ADR 0008).
    queryKey: [catalog.key, q],
    queryFn: () => catalog.suggest(q, SUGGESTION_LIMIT),
  });
}

export function useCreateItem(catalog: Catalog) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: catalog.create,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [catalog.key] }),
  });
}

export function useUnarchiveItem(catalog: Catalog) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: catalog.unarchive,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [catalog.key] }),
  });
}
