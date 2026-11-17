import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "./api/query-client";
import { App } from "./App";
import { reloadIntoSignIn } from "./auth/reload";
import { toDay } from "./lib/day";
import { CurrentUrl } from "./test-current-url";
import { emptyDay, noSuggestions, signedInAs } from "./test-handlers";
import { server } from "./test-server";

// jsdom cannot navigate, so the tests check that a reload was asked for.
vi.mock("./auth/reload");

function renderAt(path: string, client = createQueryClient()) {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
        <CurrentUrl />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const pendingHeading = () =>
  screen.findByRole("heading", { name: "Waiting for approval" });

const unauthorized = () => new HttpResponse(null, { status: 401 });

beforeEach(() => {
  vi.mocked(reloadIntoSignIn).mockClear();
  server.use(noSuggestions, emptyDay);
});

describe("a Pending User", () => {
  beforeEach(() => {
    server.use(signedInAs("pending"));
  });

  it("sees only the waiting screen", async () => {
    renderAt("/exercise");

    expect(await pendingHeading()).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Meals" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign out" })).toHaveAttribute(
      "href",
      "/oauth2/sign_out",
    );
  });

  it("stays on the waiting screen when checking before approval", async () => {
    renderAt("/exercise");
    await userEvent.click(
      await screen.findByRole("button", { name: "Check again" }),
    );

    expect(
      await screen.findByRole("button", { name: "Check again" }),
    ).toBeEnabled();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Waiting for approval",
    );
  });

  it("opens the app at the same link after approval", async () => {
    renderAt("/meals?day=2026-11-02");
    await pendingHeading();

    server.use(signedInAs("member"));
    await userEvent.click(screen.getByRole("button", { name: "Check again" }));

    expect(
      await screen.findByRole("heading", { name: "Meals on 2026-11-02" }),
    ).toBeInTheDocument();
  });
});

describe("a new identity while Sign-up is closed", () => {
  const signupClosed = http.get("*/api/me", () =>
    HttpResponse.json(
      {
        type: "urn:health-tracker:problem:signup-closed",
        title: "Forbidden",
        status: 403,
        detail: "Sign-up is closed.",
      },
      { status: 403 },
    ),
  );

  it("sees only the closed screen, with Sign out and no retry", async () => {
    server.use(signupClosed);
    renderAt("/exercise");

    expect(
      await screen.findByRole("heading", { name: "Sign-up is closed" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign out" })).toHaveAttribute(
      "href",
      "/oauth2/sign_out",
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Meals" }),
    ).not.toBeInTheDocument();
  });
});

describe("the signed-in check", () => {
  it("shows the failure and recovers on Try again", async () => {
    server.use(
      http.get("*/api/me", () =>
        HttpResponse.json(
          {
            type: "about:blank",
            title: "Service Unavailable",
            status: 503,
          },
          { status: 503 },
        ),
      ),
    );
    // Retries are shouldRetry's own test; here they would only add 3 s of backoff.
    const client = createQueryClient();
    client.setDefaultOptions({ queries: { retry: false } });
    renderAt("/exercise", client);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Service Unavailable",
    );

    server.use(signedInAs("member"));
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByRole("heading", { name: /^Exercise on/ }),
    ).toBeInTheDocument();
  });
});

describe("a 401", () => {
  it("on load reloads the page into sign-in", async () => {
    server.use(http.get("*/api/me", unauthorized));
    renderAt("/exercise");

    await vi.waitFor(() => {
      expect(reloadIntoSignIn).toHaveBeenCalled();
    });
  });

  it("from any later call reloads the page into sign-in", async () => {
    server.use(
      signedInAs("member"),
      http.get("*/api/v1/exercise-entries", unauthorized),
    );
    renderAt("/exercise");

    await vi.waitFor(() => {
      expect(reloadIntoSignIn).toHaveBeenCalled();
    });
  });
});

describe("the shell", () => {
  beforeEach(() => {
    server.use(signedInAs("member"));
  });

  it("starts on the Exercise window, viewing today", async () => {
    renderAt("/");

    expect(
      await screen.findByRole("heading", {
        name: `Exercise on ${toDay(new Date())}`,
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("url")).toHaveTextContent("/exercise");
  });

  it("keeps the viewed Day when switching windows", async () => {
    renderAt("/exercise?day=2026-11-02");

    await userEvent.click(await screen.findByRole("link", { name: "Meals" }));

    expect(
      await screen.findByRole("heading", { name: "Meals on 2026-11-02" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Meals" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("reaches Search from the header icon", async () => {
    renderAt("/exercise");

    await userEvent.click(await screen.findByRole("link", { name: "Search" }));

    expect(
      await screen.findByRole("heading", { name: "Search" }),
    ).toBeInTheDocument();
  });

  it("reaches Dashboards from the header icon, and comes back to the same Day", async () => {
    renderAt("/meals?day=2026-11-02");

    await userEvent.click(
      await screen.findByRole("link", { name: "Dashboards" }),
    );

    // The screen is its own chunk, loaded on this first visit.
    expect(
      await screen.findByRole("heading", { name: "Dashboards" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute(
      "href",
      "/meals?day=2026-11-02",
    );
  });

  it("shows Problem Details when the API refuses a call", async () => {
    server.use(
      http.get("*/api/v1/exercises", () =>
        HttpResponse.json(
          {
            type: "about:blank",
            title: "Unprocessable Content",
            status: 422,
            detail: "The request is not valid.",
            errors: [{ field: "limit", message: "Too large." }],
          },
          { status: 422 },
        ),
      ),
    );
    renderAt("/exercise");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The request is not valid.");
    expect(alert).toHaveTextContent("limit: Too large.");
  });

  it("shows not found on an unknown path", async () => {
    renderAt("/no-such-page");
    expect(
      await screen.findByRole("heading", { name: "Page not found" }),
    ).toBeInTheDocument();
  });
});
