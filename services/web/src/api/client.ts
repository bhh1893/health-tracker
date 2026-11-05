import createClient from "openapi-fetch";

import type { paths } from "./schema";

// Relative on purpose: the page and the API share one origin (ADR 0001), so one
// image runs in every environment with no API URL to configure (ADR 0007).
export const API_BASE_URL = "/api/v1";

// Resolved at run time, never configured. A browser would accept the bare path,
// but Node's fetch (under Vitest) rejects relative URLs.
export const api = createClient<paths>({
  baseUrl: new URL(API_BASE_URL, window.location.origin).href,
});
