import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { reloadIntoSignIn } from "../auth/reload";
import { server } from "../test-server";
import { api, ApiError, unwrap } from "./client";

// jsdom cannot navigate, so the tests check that a reload was asked for.
vi.mock("../auth/reload");

const listExercises = () => api.GET("/api/v1/exercises");

function respondWith(body: string | null, init: ResponseInit) {
  server.use(
    http.get("*/api/v1/exercises", () => new HttpResponse(body, init)),
  );
}

beforeEach(() => {
  vi.mocked(reloadIntoSignIn).mockClear();
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

  it("carries no credential of its own", async () => {
    let header: string | null = "unset";
    server.use(
      http.get("*/api/v1/exercises", ({ request }) => {
        header = request.headers.get("Authorization");
        return HttpResponse.json([]);
      }),
    );

    await listExercises();

    expect(header).toBeNull();
  });
});

describe("an expired session", () => {
  it("reloads the page into sign-in on a 401", async () => {
    respondWith(null, { status: 401 });

    await listExercises();

    expect(reloadIntoSignIn).toHaveBeenCalledOnce();
  });

  it("does not reload on a 403, which is a signed-in User refused", async () => {
    respondWith(null, { status: 403 });

    await listExercises();

    expect(reloadIntoSignIn).not.toHaveBeenCalled();
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
