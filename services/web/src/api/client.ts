import createClient, { type Middleware } from "openapi-fetch";

import { getAuthState, rejectToken } from "../auth/token";
import type { components, paths } from "./schema";

export type Problem = components["schemas"]["Problem"];

const BEARER_PREFIX = "Bearer ";

// Every API call passes through here, so no screen handles the token itself.
const authMiddleware: Middleware = {
  onRequest({ request }) {
    const { token } = getAuthState();
    if (token !== null) {
      request.headers.set("Authorization", `${BEARER_PREFIX}${token}`);
    }
    return request;
  },
  onResponse({ request, response }) {
    const sent = request.headers.get("Authorization");
    if (response.status === 401 && sent?.startsWith(BEARER_PREFIX)) {
      rejectToken(sent.slice(BEARER_PREFIX.length));
    }
    return response;
  },
};

// The origin alone: the paths in schema.d.ts already start with /api/v1. It is
// resolved at run time, never configured, because the page and the API share one
// origin (ADR 0001), so one image runs in every environment (ADR 0007). A browser
// would accept an empty base, but Node's fetch (under Vitest) rejects relative URLs.
export const api = createClient<paths>({ baseUrl: window.location.origin });
api.use(authMiddleware);

// An API call that failed, always carrying Problem Details so screens have one
// shape to display and branch on, whatever produced the error.
export class ApiError extends Error {
  readonly problem: Problem;

  constructor(problem: Problem) {
    super(problem.detail ?? problem.title);
    this.name = "ApiError";
    this.problem = problem;
  }
}

function isProblem(body: unknown): body is Problem {
  return (
    typeof body === "object" &&
    body !== null &&
    "title" in body &&
    "status" in body
  );
}

// Not every failure comes from `api`: the Gateway or a proxy can answer with an
// HTML page, which openapi-fetch hands back as a plain string.
function toProblem(body: unknown, response: Response): Problem {
  if (isProblem(body)) {
    return body;
  }
  return {
    type: "about:blank",
    title: response.statusText || "Request failed",
    status: response.status,
  };
}

interface FetchResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

// Turns openapi-fetch's { data, error } into the throw TanStack Query expects.
export async function unwrap<T>(call: Promise<FetchResult<T>>): Promise<T> {
  const { data, error, response } = await call;
  if (!response.ok) {
    throw new ApiError(toProblem(error, response));
  }
  return data as T;
}
