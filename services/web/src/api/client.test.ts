import { http, HttpResponse } from "msw";
import { expect, it } from "vitest";

import { server } from "../test-server";
import { api, API_BASE_URL } from "./client";
import type { components } from "./schema";

it("calls the API on the page's own origin, under the base URL", async () => {
  // `/healthz` is the only GET in the contract so far. It is not really under
  // /api/v1 (ADR 0006); this test is about how the URL is built. Typing the body
  // from the contract means a schema change breaks compilation here.
  const body: components["schemas"]["HealthStatus"] = { status: "ok" };
  let requested = "";
  server.use(
    http.get(`${API_BASE_URL}/healthz`, ({ request }) => {
      requested = request.url;
      return HttpResponse.json(body);
    }),
  );

  const { data } = await api.GET("/healthz");

  expect(data).toEqual(body);
  expect(requested).toBe(`${window.location.origin}/api/v1/healthz`);
});
