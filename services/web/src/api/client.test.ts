import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { forgetToken, getAuthState, saveToken } from "../auth/token";
import { GOOD_TOKEN } from "../test-handlers";
import { server } from "../test-server";
import { api, ApiError, unwrap } from "./client";

const listExercises = () => api.GET("/api/v1/exercises");

function respondWith(body: string | null, init: ResponseInit) {
  server.use(
    http.get("*/api/v1/exercises", () => new HttpResponse(body, init)),
  );
}

beforeEach(() => {
  forgetToken();
});

describe("requests", () => {
  it("calls the contract's path on the page's own origin", async () => {
    let requested = "";
    server.use(
      http.get("*/api/v1/exercises", ({ request }) => {
        requested = request.url;
        return HttpResponse.json([]);
      }),
    );

    await listExercises();

    expect(requested).toBe(`${window.location.origin}/api/v1/exercises`);
  });

  it("attaches the saved token as a bearer token", async () => {
    saveToken(GOOD_TOKEN);
    let header: string | null = null;
    server.use(
      http.get("*/api/v1/exercises", ({ request }) => {
        header = request.headers.get("Authorization");
        return HttpResponse.json([]);
      }),
    );

    await listExercises();

    expect(header).toBe(`Bearer ${GOOD_TOKEN}`);
  });
});

describe("a 401", () => {
  it("forgets the token that was refused", async () => {
    saveToken("bad-token");
    respondWith(null, { status: 401 });

    await listExercises();

    expect(getAuthState()).toEqual({ token: null, rejected: true });
  });

  it("keeps a newer token when a slow 401 arrives for an old one", async () => {
    saveToken("old-token");
    server.use(
      http.get("*/api/v1/exercises", () => {
        saveToken("new-token");
        return new HttpResponse(null, { status: 401 });
      }),
    );

    await listExercises();

    expect(getAuthState()).toEqual({ token: "new-token", rejected: false });
  });
});

describe("unwrap", () => {
  it("returns the data of a success", async () => {
    respondWith("[]", { status: 200 });

    await expect(unwrap(listExercises())).resolves.toEqual([]);
  });

  it("throws the Problem Details of a failure", async () => {
    const problem = { type: "about:blank", title: "Conflict", status: 409 };
    respondWith(JSON.stringify(problem), { status: 409 });

    await expect(unwrap(listExercises())).rejects.toMatchObject({ problem });
  });

  it("builds a Problem when a proxy answers with HTML", async () => {
    respondWith("<html>Bad Gateway</html>", {
      status: 502,
      statusText: "Bad Gateway",
    });

    const error = await unwrap(listExercises()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      problem: { title: "Bad Gateway", status: 502 },
    });
  });
});
