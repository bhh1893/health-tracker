import { http, HttpResponse } from "msw";

import type { Problem } from "./api/client";
import type { components, paths } from "./api/schema";

export const GOOD_TOKEN = "good-token";

type ExerciseSuggestions =
  paths["/api/v1/exercises"]["get"]["responses"][200]["content"]["application/json"];

const unauthorized: Problem = {
  type: "about:blank",
  title: "Unauthorized",
  status: 401,
};

// Stands in for the sidecar in front of `api` (ADR 0010). Typed from the contract,
// so a schema change breaks compilation here (ADR 0014).
export const exercisesBehindEdge = http.get<
  never,
  never,
  ExerciseSuggestions | Problem
>("*/api/v1/exercises", ({ request }) => {
  if (request.headers.get("Authorization") !== `Bearer ${GOOD_TOKEN}`) {
    return HttpResponse.json(unauthorized, {
      status: 401,
      headers: {
        "Content-Type": "application/problem+json",
        "WWW-Authenticate": "Bearer",
      },
    });
  }
  return HttpResponse.json([]);
});

type CatalogRef = components["schemas"]["CatalogRef"];
type ExerciseEntry = components["schemas"]["ExerciseEntry"];
type ExerciseEntryPage = components["schemas"]["ExerciseEntryPage"];
type PutExerciseEntry = components["schemas"]["PutExerciseEntry"];

export const emptyDay = http.get<never, never, ExerciseEntryPage>(
  "*/api/v1/exercise-entries",
  () => HttpResponse.json({ items: [], next_cursor: null }),
);

export const bench: CatalogRef = {
  id: "0190a000-0000-7000-8000-000000000001",
  name: "Bench Press",
  archived: false,
};

export function aSet(fields: Partial<ExerciseEntry> = {}): ExerciseEntry {
  return {
    id: "0190a000-0000-7000-8000-0000000000a1",
    day: "2026-11-02",
    number: 1,
    exercise: bench,
    reps: 5,
    weight_lb: 135,
    occurred_at: "2026-11-02T18:00:00+13:00",
    occurred_tz: "Pacific/Auckland",
    ...fields,
  };
}

// A small stand-in for `api`: it keeps what it is sent, so a test can reload the feed
// and see what the server would hold. `catalog` is what suggestions search.
export function fakeExerciseApi(
  seed: ExerciseEntry[] = [],
  catalog: CatalogRef[] = [bench],
) {
  const entries = new Map(seed.map((entry) => [entry.id, entry]));
  const puts: { id: string; body: PutExerciseEntry }[] = [];
  const queries: string[] = [];

  const handlers = [
    http.get<never, never, ExerciseEntryPage>(
      "*/api/v1/exercise-entries",
      ({ request }) => {
        const day = new URL(request.url).searchParams.get("from");
        const items = [...entries.values()].filter((e) => e.day === day);
        return HttpResponse.json({ items, next_cursor: null });
      },
    ),
    http.put<{ entry_id: string }, PutExerciseEntry, ExerciseEntry>(
      "*/api/v1/exercise-entries/:entry_id",
      async ({ request, params }) => {
        const body = await request.json();
        const id = params.entry_id;
        puts.push({ id, body });
        const exercise = catalog.find((e) => e.id === body.exercise_id);
        if (exercise === undefined) {
          throw new Error(`Unknown Exercise ${body.exercise_id}`);
        }
        const entry = aSet({
          id,
          exercise,
          reps: body.reps,
          weight_lb: body.weight_lb ?? null,
          occurred_at: body.occurred_at,
          occurred_tz: body.occurred_tz,
          day: body.occurred_at.slice(0, 10),
        });
        const created = !entries.has(id);
        entries.set(id, entry);
        return HttpResponse.json(entry, { status: created ? 201 : 200 });
      },
    ),
    http.delete<{ entry_id: string }>(
      "*/api/v1/exercise-entries/:entry_id",
      ({ params }) => {
        entries.delete(params.entry_id);
        return new HttpResponse(null, { status: 204 });
      },
    ),
    http.get<never, never, ExerciseSuggestions>(
      "*/api/v1/exercises",
      ({ request }) => {
        const q = new URL(request.url).searchParams.get("q") ?? "";
        queries.push(q);
        const found = catalog.filter(({ name }) =>
          name.toLowerCase().includes(q.toLowerCase()),
        );
        return HttpResponse.json(found);
      },
    ),
  ];

  return { handlers, entries, puts, queries };
}
