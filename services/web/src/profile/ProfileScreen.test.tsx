import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { App } from "../App";
import { DAY_TOTALS_KEY } from "../nutrition/queries";
import { renderAt } from "../test-render";
import { RESTAURANT_DAY_KCAL, signedInAs } from "../test-handlers";
import { server } from "../test-server";

// Through App, as on the phone: App loads /api/me first and Profile reads the cache.
async function identity() {
  return screen.findByRole("region", { name: "Signed in as" });
}

describe("ProfileScreen", () => {
  it("shows the avatar letter, name and email", async () => {
    server.use(signedInAs("member", { name: "bao", email: "b@example.test" }));
    renderAt("/profile", <App />);

    const block = await identity();
    expect(within(block).getByText("B")).toBeInTheDocument();
    expect(within(block).getByText("bao")).toBeInTheDocument();
    expect(within(block).getByText("b@example.test")).toBeInTheDocument();
  });

  it("leaves out a missing name instead of a blank line", async () => {
    server.use(signedInAs("member", { name: null, email: "b@example.test" }));
    renderAt("/profile", <App />);

    const block = await identity();
    // One letter from the email, then the email: no empty name line.
    expect(within(block).getByText("B")).toBeInTheDocument();
    expect(within(block).getAllByRole("paragraph")).toHaveLength(1);
  });

  it("shows only the icon when name and email are both missing", async () => {
    server.use(signedInAs("member", { name: null, email: null }));
    renderAt("/profile", <App />);

    const block = await identity();
    expect(within(block).queryAllByRole("paragraph")).toHaveLength(0);
    expect(block.querySelector("svg")).not.toBeNull();
  });

  it("signs out through the proxy with a plain link", async () => {
    server.use(signedInAs("member"));
    renderAt("/profile", <App />);
    await identity();

    // A full page load to the sidecar, so a real href, not a router path.
    expect(screen.getByRole("link", { name: "Sign out" })).toHaveAttribute(
      "href",
      "/oauth2/sign_out",
    );
  });

  it("saves the Restaurant Day calories and marks cached Day totals stale", async () => {
    const patches: unknown[] = [];
    server.use(
      signedInAs("member"),
      http.patch("*/api/me", async ({ request }) => {
        const body = (await request.json()) as { restaurant_day_kcal: number };
        patches.push(body);
        return HttpResponse.json({ role: "member", ...body });
      }),
    );
    const { client } = renderAt("/profile", <App />);
    // Day totals History read earlier, still in the cache.
    const cached = [DAY_TOTALS_KEY, "2026-11-01", "2026-11-19"];
    client.setQueryData(cached, []);

    const settings = await screen.findByRole("region", { name: "Settings" });
    const field = within(settings).getByRole("textbox", {
      name: "Restaurant Day calories",
    });
    expect(field).toHaveValue(RESTAURANT_DAY_KCAL.toLocaleString("en-US"));
    const save = within(settings).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    await userEvent.clear(field);
    await userEvent.type(field, "3500");
    await userEvent.click(save);

    await waitFor(() => {
      expect(patches).toEqual([{ restaurant_day_kcal: 3500 }]);
    });
    // Every past Restaurant Day changed on the server, so History reads them again
    // on its next visit (ADR 0032).
    await waitFor(() => {
      expect(client.getQueryState(cached)?.isInvalidated).toBe(true);
    });
    expect(field).toHaveValue("3,500");
  });
});
