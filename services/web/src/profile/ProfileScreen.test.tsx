import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "../App";
import { renderAt } from "../test-render";
import { signedInAs } from "../test-handlers";
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
});
