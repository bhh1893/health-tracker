import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { App } from "./App";

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe("App", () => {
  it("shows the hello page at the root", () => {
    renderAt("/");
    expect(
      screen.getByRole("heading", { name: "Health Tracker" }),
    ).toBeInTheDocument();
  });

  it("generates an ID when the button is pressed", async () => {
    renderAt("/");
    await userEvent.click(screen.getByRole("button", { name: "Generate ID" }));
    expect(screen.getByText(/^[0-9a-f]{8}-[0-9a-f]{4}-7/)).toBeInTheDocument();
  });

  it("shows not found on an unknown path", () => {
    renderAt("/no-such-page");
    expect(
      screen.getByRole("heading", { name: "Page not found" }),
    ).toBeInTheDocument();
  });
});
