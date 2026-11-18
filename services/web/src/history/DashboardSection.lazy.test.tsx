import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { expect, it, vi } from "vitest";

import { renderAt } from "../test-render";
import { server } from "../test-server";
import { HistoryScreen } from "./HistoryScreen";
import { loadDashboard } from "./loadDashboard";

// A spy that still runs the real import(), so the screen behaves as in
// production and the test can see when the chunk was asked for.
vi.mock("./loadDashboard", { spy: true });

// Its own file: React.lazy calls its loader once per module instance, so a test
// before this one that opened the Dashboard would leave nothing to observe.
it("imports the chart chunk on the first open of the Dashboard, not with History", async () => {
  server.use(
    http.get("*/api/v1/days", () => HttpResponse.json([])),
    http.get("*/api/v1/meals", () =>
      HttpResponse.json({ items: [], next_cursor: null }),
    ),
    http.get("*/api/v1/meal-days", () =>
      HttpResponse.json({ items: [], next_cursor: null }),
    ),
    http.get("*/api/me", () =>
      HttpResponse.json({ restaurant_day_kcal: 5000 }),
    ),
  );
  renderAt("/history", <HistoryScreen />);
  // React.lazy calls its loader during the render that first shows the lazy
  // component, so a screen that rendered it would already have called it here.
  expect(loadDashboard).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole("button", { name: /^Dashboard/ }));

  expect(loadDashboard).toHaveBeenCalledOnce();
  expect(
    await within(screen.getByRole("group", { name: /^Dashboard/ })).findByText(
      "No Meals in this range.",
    ),
  ).toBeInTheDocument();
});
