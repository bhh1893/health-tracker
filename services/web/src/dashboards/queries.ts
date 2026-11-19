import { useQuery } from "@tanstack/react-query";

import { api, unwrap } from "../api/client";
import { addDays } from "../lib/day";
import type { ExerciseSession } from "../exercise/sessions";

// The API's cap on `limit` for Sessions (ADR 0006).
const MAX_SESSIONS = 200;

// Every Session of one Exercise from `from` (null: the beginning) to `to`, newest
// first. A full page may not be the end, so the next request asks for Sessions
// before the oldest Day already read. Pages are whole Sessions, so none is split.
export async function fetchSessions(
  exerciseId: string,
  from: string | null,
  to: string,
) {
  const sessions: ExerciseSession[] = [];
  let end: string | null = to;
  while (end !== null) {
    const page: ExerciseSession[] = await unwrap(
      api.GET("/api/v1/exercises/{exercise_id}/sessions", {
        params: {
          path: { exercise_id: exerciseId },
          query: { limit: MAX_SESSIONS, from, to: end },
        },
      }),
    );
    sessions.push(...page);
    const oldest = page.at(-1);
    end =
      page.length === MAX_SESSIONS && oldest !== undefined
        ? addDays(oldest.day, -1)
        : null;
  }
  return sessions;
}

// Every Set write marks these stale: any Set can change a Session's top Set.
export const DASHBOARD_SESSIONS_KEY = ["dashboards", "sessions"];

export function useExerciseHistory(
  exerciseId: string,
  from: string | null,
  to: string,
) {
  return useQuery({
    queryKey: [...DASHBOARD_SESSIONS_KEY, exerciseId, from, to],
    queryFn: () => fetchSessions(exerciseId, from, to),
  });
}
