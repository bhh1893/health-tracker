import { http, HttpResponse } from "msw";

import type { Problem } from "./api/client";
import type { paths } from "./api/schema";

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
