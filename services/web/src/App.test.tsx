import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, useLocation } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";

import { createQueryClient } from "./api/query-client";
import { App } from "./App";
import { forgetToken, saveToken } from "./auth/token";
import { toDay } from "./lib/day";
import { exercisesBehindEdge, GOOD_TOKEN } from "./test-handlers";
import { server } from "./test-server";

function CurrentUrl() {
  const { pathname, search } = useLocation();
  return <output aria-label="url">{`${pathname}${search}`}</output>;
}

function renderAt(path: string) {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <App />
        <CurrentUrl />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const secretHeading = () =>
  screen.findByRole("heading", { name: "Enter secret" });

async function submitSecret(secret: string) {
  await userEvent.type(screen.getByLabelText("Secret"), secret);
  await userEvent.click(screen.getByRole("button", { name: "Continue" }));
}

beforeEach(() => {
  forgetToken();
  server.use(exercisesBehindEdge);
});

describe("the 401 flow", () => {
  it("asks for the secret when none is saved", async () => {
    renderAt("/");
    expect(await secretHeading()).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("loads the shell after a good secret, and stays there", async () => {
    renderAt("/");
    await submitSecret(GOOD_TOKEN);

    expect(
      await screen.findByRole("heading", { name: /^Exercise on/ }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "Enter secret" }),
      ).not.toBeInTheDocument();
    });
  });

  it("returns to the secret screen and says why after a bad secret", async () => {
    renderAt("/");
    await submitSecret("bad-token");

    expect(await secretHeading()).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("not accepted");
  });

  it("recovers: a good secret after a bad one loads the shell", async () => {
    renderAt("/");
    await submitSecret("bad-token");
    await screen.findByRole("alert");
    await submitSecret(GOOD_TOKEN);

    expect(
      await screen.findByRole("heading", { name: /^Exercise on/ }),
    ).toBeInTheDocument();
  });

  it("returns to the secret screen when a saved secret stops working", async () => {
    saveToken("rotated-away");
    renderAt("/exercise");

    expect(await secretHeading()).toBeInTheDocument();
  });

  it("keeps the deep link through the secret screen", async () => {
    renderAt("/meals?day=2026-11-02");
    await submitSecret(GOOD_TOKEN);

    expect(
      await screen.findByRole("heading", { name: "Meals on 2026-11-02" }),
    ).toBeInTheDocument();
  });
});

describe("the shell", () => {
  beforeEach(() => {
    saveToken(GOOD_TOKEN);
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

    await userEvent.click(screen.getByRole("link", { name: "Meals" }));

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

    await userEvent.click(screen.getByRole("link", { name: "Search" }));

    expect(
      await screen.findByRole("heading", { name: "Search" }),
    ).toBeInTheDocument();
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

  it("shows not found on an unknown path", () => {
    renderAt("/no-such-page");
    expect(
      screen.getByRole("heading", { name: "Page not found" }),
    ).toBeInTheDocument();
  });
});
