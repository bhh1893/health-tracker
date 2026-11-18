import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import type { Catalog, CatalogItem, Rename } from "./catalogs";

const SUGGESTION_LIMIT = 10;
// The API's maximum (ADR 0032): a Profile page loads the whole Catalog in one call.
export const LIST_LIMIT = 1000;

// Every key starts with the Catalog's own, so invalidating [catalog.key] after any
// write refreshes suggestions, Profile's list and an open sheet together. Suggestions
// are [key, q, includeArchived]; the list and an item put an object second, so no
// typed q can land in their slot.
const listKey = (catalog: Catalog, includeArchived: boolean) => [
  catalog.key,
  { list: true, includeArchived },
];
export const itemKey = (catalog: Catalog, id: string) => [catalog.key, { id }];

export function useSuggestions(
  catalog: Catalog,
  q: string,
  includeArchived: boolean,
) {
  return useQuery({
    // q in the key means a slow answer for "ben" can never replace the one for
    // "bench": each lands in its own cache slot (ADR 0008).
    queryKey: [catalog.key, q, includeArchived],
    queryFn: () => catalog.suggest(q, SUGGESTION_LIMIT, includeArchived),
  });
}

// The whole Catalog for a Profile page, which filters it in the browser (ADR 0032).
// An empty q keeps the API's order: most recently used first, then by name.
export function useCatalogList(catalog: Catalog, includeArchived: boolean) {
  return useQuery({
    queryKey: listKey(catalog, includeArchived),
    queryFn: () => catalog.suggest("", LIST_LIMIT, includeArchived),
    // Turning "Show archived" on or off keeps the rows on screen until the other
    // list arrives, instead of flashing "Loading...".
    placeholderData: keepPreviousData,
  });
}

export function useCatalogItem(catalog: Catalog, id: string) {
  return useQuery({
    queryKey: itemKey(catalog, id),
    queryFn: () => catalog.get(id),
  });
}

// A name or an archived flag changed, so every screen that shows it must ask again.
// Only screens on view refetch now; the rest are marked stale and refetch when shown.
export function refreshAfterItemWrite(
  queryClient: QueryClient,
  catalog: Catalog,
) {
  void queryClient.invalidateQueries({ queryKey: [catalog.key] });
  for (const key of catalog.shownIn) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
}

export function useCreateItem(catalog: Catalog) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: catalog.create,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [catalog.key] }),
  });
}

// The logging combobox's "Unarchive X". Only the Catalog asks again: the open Day's
// feed may hold an optimistic Entry that a refetch now would drop.
export function useUnarchiveItem(catalog: Catalog) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => catalog.setArchived(id, false),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [catalog.key] }),
  });
}

export function useRenameItem(catalog: Catalog, id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (change: Rename) => catalog.rename(id, change),
    onSuccess: (item: CatalogItem) => {
      queryClient.setQueryData(itemKey(catalog, id), item);
      refreshAfterItemWrite(queryClient, catalog);
    },
  });
}

export function useSetArchived(catalog: Catalog, id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (archived: boolean) => catalog.setArchived(id, archived),
    onSuccess: (item: CatalogItem) => {
      queryClient.setQueryData(itemKey(catalog, id), item);
      refreshAfterItemWrite(queryClient, catalog);
    },
  });
}

// Only a never-used item can go (the API answers 409 otherwise), so no Entry shows
// it and only the Catalog's own lists need to ask again.
export function useDeleteItem(catalog: Catalog, id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => catalog.remove(id),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: itemKey(catalog, id) });
      return queryClient.invalidateQueries({ queryKey: [catalog.key] });
    },
  });
}
