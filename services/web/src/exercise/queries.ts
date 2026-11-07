import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import { api, unwrap } from "../api/client";
import { currentTimeZone, toRfc3339 } from "../lib/occurred";
import type { CatalogRef, ExerciseEntry, ExerciseEntryPage } from "./sessions";

const MAX_PAGE_SIZE = 200;
const SUGGESTION_LIMIT = 10;

const EXERCISES_KEY = ["exercises"];
const ENTRY_WRITES_KEY = ["exercise-entry-write"];
const dayKey = (day: string) => ["exercise-entries", day];

// Writes run one at a time, in the order they were made. Without this, deleting a Set
// whose PUT is still in flight could reach the server first, and the PUT would bring
// the Set back. Optimistic updates still apply at once: only the request waits.
const ENTRY_WRITES_SCOPE = { id: "exercise-entry-writes" };

async function fetchDay(day: string) {
  const entries: ExerciseEntry[] = [];
  let cursor: string | null = null;
  do {
    const page: ExerciseEntryPage = await unwrap(
      api.GET("/api/v1/exercise-entries", {
        params: {
          query: { from: day, to: day, limit: MAX_PAGE_SIZE, cursor },
        },
      }),
    );
    entries.push(...page.items);
    cursor = page.next_cursor;
  } while (cursor !== null);
  return entries;
}

export function useDayEntries(day: string) {
  return useQuery({ queryKey: dayKey(day), queryFn: () => fetchDay(day) });
}

export function useExerciseSuggestions(q: string) {
  return useQuery({
    // q in the key means a slow answer for "ben" can never replace the one for
    // "bench": each lands in its own cache slot (ADR 0008).
    queryKey: [...EXERCISES_KEY, q],
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/exercises", {
          params: { query: { q, limit: SUGGESTION_LIMIT } },
        }),
      ),
  });
}

interface NewEntry {
  // Made by the caller, before the request: every retry of this write must reuse it.
  id: string;
  day: string;
  exercise: CatalogRef;
  reps: number;
  weight_lb: number | null;
  occurredAt: Date;
}

// The Entry as the feed will show it, before the server has answered. `number` is
// not read: groupSessions numbers by position.
export function newEntry({ occurredAt, ...fields }: NewEntry): ExerciseEntry {
  return {
    ...fields,
    number: 0,
    occurred_at: toRfc3339(occurredAt),
    occurred_tz: currentTimeZone(),
  };
}

function editDay(
  queryClient: QueryClient,
  day: string,
  edit: (entries: ExerciseEntry[]) => ExerciseEntry[],
) {
  queryClient.setQueryData<ExerciseEntry[]>(
    dayKey(day),
    (entries) => entries && edit(entries),
  );
}

const without = (id: string) => (entries: ExerciseEntry[]) =>
  entries.filter((entry) => entry.id !== id);

const withEntry = (added: ExerciseEntry) => (entries: ExerciseEntry[]) => [
  ...without(added.id)(entries),
  added,
];

// Stops a refetch started before this write from overwriting the optimistic change.
function cancelDayFetch(queryClient: QueryClient, day: string) {
  return queryClient.cancelQueries({ queryKey: dayKey(day) });
}

// Replaces the guess with the server's answer, once no other write is pending: a
// refetch while one is, would drop that write's optimistic Set from the feed.
function refreshWhenIdle(queryClient: QueryClient, day: string) {
  if (queryClient.isMutating({ mutationKey: ENTRY_WRITES_KEY }) === 1) {
    void queryClient.invalidateQueries({ queryKey: dayKey(day) });
    // Logging a Set changes which Exercises are most recent (ADR 0008).
    void queryClient.invalidateQueries({ queryKey: EXERCISES_KEY });
  }
}

function putEntry(entry: ExerciseEntry) {
  return unwrap(
    api.PUT("/api/v1/exercise-entries/{entry_id}", {
      params: { path: { entry_id: entry.id } },
      body: {
        exercise_id: entry.exercise.id,
        reps: entry.reps,
        weight_lb: entry.weight_lb,
        occurred_at: entry.occurred_at,
        occurred_tz: entry.occurred_tz,
      },
    }),
  );
}

export function useAddSet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ENTRY_WRITES_KEY,
    scope: ENTRY_WRITES_SCOPE,
    mutationFn: putEntry,
    onMutate: async (entry) => {
      await cancelDayFetch(queryClient, entry.day);
      editDay(queryClient, entry.day, withEntry(entry));
    },
    // Undoes this one write, not "restore the list as it was": with two writes in
    // flight, restoring a snapshot would also erase the other, successful one.
    onError: (_error, entry) => {
      editDay(queryClient, entry.day, without(entry.id));
    },
    onSettled: (_data, _error, entry) => {
      refreshWhenIdle(queryClient, entry.day);
    },
  });
}

interface SetEdit {
  before: ExerciseEntry;
  after: ExerciseEntry;
}

// Only time, weight and reps can change, so a Set stays on its Day.
export function useEditSet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ENTRY_WRITES_KEY,
    scope: ENTRY_WRITES_SCOPE,
    mutationFn: ({ after }: SetEdit) => putEntry(after),
    onMutate: async ({ after }) => {
      await cancelDayFetch(queryClient, after.day);
      editDay(queryClient, after.day, withEntry(after));
    },
    onError: (_error, { before }) => {
      editDay(queryClient, before.day, withEntry(before));
    },
    onSettled: (_data, _error, { after }) => {
      refreshWhenIdle(queryClient, after.day);
    },
  });
}

export function useDeleteSet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ENTRY_WRITES_KEY,
    scope: ENTRY_WRITES_SCOPE,
    mutationFn: (entry: ExerciseEntry) =>
      unwrap(
        api.DELETE("/api/v1/exercise-entries/{entry_id}", {
          params: { path: { entry_id: entry.id } },
        }),
      ),
    onMutate: async (entry) => {
      await cancelDayFetch(queryClient, entry.day);
      editDay(queryClient, entry.day, without(entry.id));
    },
    onError: (_error, entry) => {
      editDay(queryClient, entry.day, withEntry(entry));
    },
    onSettled: (_data, _error, entry) => {
      refreshWhenIdle(queryClient, entry.day);
    },
  });
}

interface NewExercise {
  id: string;
  name: string;
  allowSimilar: boolean;
}

export function useCreateExercise() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name, allowSimilar }: NewExercise) =>
      unwrap(
        api.PUT("/api/v1/exercises/{item_id}", {
          params: { path: { item_id: id } },
          body: { name, allow_similar: allowSimilar },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: EXERCISES_KEY }),
  });
}

export function useUnarchiveExercise() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.PATCH("/api/v1/exercises/{item_id}", {
          params: { path: { item_id: id } },
          body: { archived: false, allow_similar: false },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: EXERCISES_KEY }),
  });
}
