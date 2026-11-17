import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { addDays, formatDay, toDay } from "../lib/day";
import type { DayTotal } from "../nutrition/totals";
import type { ExerciseSession } from "../search/days";
import { aMeal, bench } from "../test-handlers";
import { renderAt } from "../test-render";
import { server } from "../test-server";
import DashboardsScreen from "./DashboardsScreen";
import { fetchSessions } from "./queries";

const today = toDay(new Date());
const daysAgo = (n: number) => addDays(today, -n);

const aTotal = (day: string, fields: Partial<DayTotal> = {}): DayTotal => ({
  day,
  kcal: 2000,
  protein_g: 150,
  carbs_g: 200,
  fat_g: 60,
  restaurant_day: false,
  incomplete: false,
  ...fields,
});

const aSession = (day: string, weight: number | null): ExerciseSession => ({
  day,
  sets: [
    { number: 1, reps: 5, weight_lb: weight },
    { number: 2, reps: 5, weight_lb: weight },
  ],
});

// Stands in for the endpoints the screen reads. Like the API, it filters by the
// inclusive Day range, answers newest first, and remembers the saved setting.
function fakeDashboardApi({
  totals = [] as DayTotal[],
  sessions = [] as ExerciseSession[],
  restaurantDayKcal = 5000,
}) {
  const requests: URL[] = [];
  const patches: unknown[] = [];
  let kcal = restaurantDayKcal;
  const inRange = (url: URL) => {
    const from = url.searchParams.get("from") ?? "";
    const to = url.searchParams.get("to") ?? "~";
    return ({ day }: { day: string }) => day >= from && day <= to;
  };
  const newestFirst = (a: { day: string }, b: { day: string }) =>
    b.day.localeCompare(a.day);

  server.use(
    http.get("*/api/v1/days", ({ request }) => {
      const url = new URL(request.url);
      requests.push(url);
      return HttpResponse.json(
        totals
          .filter(inRange(url))
          .toSorted(newestFirst)
          // The server applies the User's current value on every read.
          .map((total) => (total.restaurant_day ? { ...total, kcal } : total)),
      );
    }),
    // Asked with limit=1 for the newest Meal on or before a Day: how the screen
    // finds out whether history goes further back.
    http.get("*/api/v1/meals", ({ request }) => {
      const url = new URL(request.url);
      requests.push(url);
      const newest = totals.filter(inRange(url)).toSorted(newestFirst)[0];
      return HttpResponse.json({
        items: newest === undefined ? [] : [aMeal({ day: newest.day })],
        next_cursor: null,
      });
    }),
    http.get("*/api/v1/exercises/:id/sessions", ({ request }) => {
      const url = new URL(request.url);
      requests.push(url);
      const limit = Number(url.searchParams.get("limit"));
      return HttpResponse.json(
        sessions.filter(inRange(url)).toSorted(newestFirst).slice(0, limit),
      );
    }),
    http.get("*/api/v1/exercises", () => HttpResponse.json([bench])),
    http.get("*/api/me", () =>
      HttpResponse.json({ restaurant_day_kcal: kcal }),
    ),
    http.patch("*/api/me", async ({ request }) => {
      const body = (await request.json()) as { restaurant_day_kcal: number };
      patches.push(body);
      kcal = body.restaurant_day_kcal;
      return HttpResponse.json({ restaurant_day_kcal: kcal });
    }),
  );
  const calls = (path: string) =>
    requests.filter((url) => url.pathname.endsWith(path));
  return { calls, patches };
}

const url = () => screen.getByLabelText("url");
const tile = (label: string) => {
  const term = screen.getByText(label, { selector: "dt" });
  // The tile is the <div> holding the label and its value.
  return term.parentElement ?? term;
};

// The chart is an SVG drawn to a measured size, which jsdom does not have. The
// table under it holds the same points, so that is what these tests read.
async function tableRows(title: string) {
  await userEvent.click(
    await screen.findByRole("button", { name: `${title} as a table` }),
  );
  const table = screen.getByRole("table", { name: title });
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    );
}

const benchUrl = `id=${bench.id}&name=Bench+Press`;

describe("the Meals dashboard", () => {
  it("charts calories per Day over the last 30 days", async () => {
    const api = fakeDashboardApi({
      totals: [
        aTotal(daysAgo(1), { kcal: 2400 }),
        aTotal(daysAgo(3), { kcal: 1600 }),
        aTotal(daysAgo(40)),
      ],
    });
    renderAt("/history?tab=meals", <DashboardsScreen />);

    expect(await tableRows("Calories per Day")).toEqual([
      [formatDay(daysAgo(1)), "2,400 kcal", "P 150 g · C 200 g · F 60 g"],
      [formatDay(daysAgo(3)), "1,600 kcal", "P 150 g · C 200 g · F 60 g"],
    ]);
    expect(tile("Average")).toHaveTextContent("2,000 kcal");
    expect(tile("Average")).toHaveTextContent("over 2 logged Days");
    const [request] = api.calls("/days");
    expect(request?.searchParams.get("from")).toBe(daysAgo(29));
    expect(request?.searchParams.get("to")).toBe(today);
  });

  it("sets a Restaurant Day apart at the flat value, and marks an Incomplete Day", async () => {
    fakeDashboardApi({
      totals: [
        aTotal(daysAgo(1), {
          kcal: 5000,
          protein_g: null,
          carbs_g: null,
          fat_g: null,
          restaurant_day: true,
        }),
        aTotal(daysAgo(2), { kcal: 900, incomplete: true }),
        aTotal(daysAgo(3), { kcal: 2100 }),
      ],
    });
    renderAt("/history?tab=meals", <DashboardsScreen />);

    const rows = await tableRows("Calories per Day");

    expect(rows[0]).toEqual([
      formatDay(daysAgo(1)),
      "5,000 kcal",
      "Restaurant Day",
    ]);
    expect(rows[1]).toEqual([
      formatDay(daysAgo(2)),
      "900 kcal",
      "Incomplete Day · P 150 g · C 200 g · F 60 g",
    ]);
    expect(tile("Restaurant Days")).toHaveTextContent("1");
    expect(tile("Incomplete Days")).toHaveTextContent("1");
    // The legend names both kinds of mark, so neither depends on its color.
    const legend = screen.getAllByRole("list")[0];
    expect(legend).toHaveTextContent("Restaurant Day");
    expect(legend).toHaveTextContent("Incomplete Day");
  });

  it("asks for the range the chip names, and all of history without a start", async () => {
    const api = fakeDashboardApi({ totals: [aTotal(daysAgo(400))] });
    renderAt("/history?tab=meals", <DashboardsScreen />);
    await screen.findByText("No Meals in this range.");

    await userEvent.click(screen.getByRole("radio", { name: "90 days" }));
    await waitFor(() => {
      expect(api.calls("/days").at(-1)?.searchParams.get("from")).toBe(
        daysAgo(89),
      );
    });
    expect(url()).toHaveTextContent("/history?tab=meals&range=90d");

    await userEvent.click(screen.getByRole("radio", { name: "All" }));

    const [row] = await tableRows("Calories per Day");
    // An older year is written out, or two Novembers would look the same.
    expect(row?.[0]).toBe(
      `${formatDay(daysAgo(400))} ${daysAgo(400).slice(0, 4)}`,
    );
    // The API takes 366 Days at a time, so the screen read a second window, ending
    // on the newest Meal older than the first.
    expect(
      api
        .calls("/days")
        .slice(-2)
        .map((request) => request.searchParams.get("to")),
    ).toEqual([today, daysAgo(400)]);
  });

  it("saves the Restaurant Day calories and redraws past Days", async () => {
    const api = fakeDashboardApi({
      totals: [aTotal(daysAgo(1), { kcal: 5000, restaurant_day: true })],
    });
    renderAt("/history?tab=meals", <DashboardsScreen />);
    const field = await screen.findByRole("textbox", {
      name: "Restaurant Day calories",
    });
    expect(field).toHaveValue("5,000");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    await userEvent.clear(field);
    await userEvent.type(field, "3500");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(tile("Average")).toHaveTextContent("3,500 kcal");
    });
    expect(api.patches).toEqual([{ restaurant_day_kcal: 3500 }]);
  });

  it("says when nothing was logged", async () => {
    fakeDashboardApi({});
    renderAt("/history?tab=meals", <DashboardsScreen />);

    expect(
      await screen.findByText("No Meals in this range."),
    ).toBeInTheDocument();
  });
});

describe("the Exercise dashboard", () => {
  it("asks for an Exercise first, then charts its top Set and volume", async () => {
    const api = fakeDashboardApi({
      sessions: [aSession(daysAgo(2), 145), aSession(daysAgo(9), 135)],
    });
    renderAt("/history?range=90d", <DashboardsScreen />);
    expect(
      screen.getByText("Pick an Exercise to see its progress."),
    ).toBeInTheDocument();

    await userEvent.type(
      screen.getByRole("combobox", { name: "Exercise" }),
      "ben",
    );
    await userEvent.click(
      await screen.findByRole("option", { name: "Bench Press" }),
    );

    expect(await tableRows("Top Set weight")).toEqual([
      [formatDay(daysAgo(2)), "145 lb", "145 lb × 5, 2 Sets"],
      [formatDay(daysAgo(9)), "135 lb", "135 lb × 5, 2 Sets"],
    ]);
    expect(await tableRows("Volume")).toEqual([
      [formatDay(daysAgo(2)), "1,450 lb", "2 Sets"],
      [formatDay(daysAgo(9)), "1,350 lb", "2 Sets"],
    ]);
    expect(tile("Sessions")).toHaveTextContent("2");
    expect(tile("Best top Set")).toHaveTextContent("145 lb × 5");
    expect(tile("Change")).toHaveTextContent("+10 lb");
    expect(url()).toHaveTextContent(`/history?range=90d&${benchUrl}`);
    const request = api.calls("/sessions").at(-1);
    expect(request?.searchParams.get("from")).toBe(daysAgo(89));
    expect(request?.searchParams.get("to")).toBe(today);
  });

  it("charts a bodyweight Exercise by reps, with no volume", async () => {
    fakeDashboardApi({
      sessions: [aSession(daysAgo(1), null), aSession(daysAgo(5), null)],
    });
    renderAt(`/history?${benchUrl}`, <DashboardsScreen />);

    expect(await tableRows("Top Set reps")).toEqual([
      [formatDay(daysAgo(1)), "5 reps", "BW × 5, 2 Sets"],
      [formatDay(daysAgo(5)), "5 reps", "BW × 5, 2 Sets"],
    ]);
    expect(
      screen.queryByRole("button", { name: "Volume as a table" }),
    ).not.toBeInTheDocument();
  });

  it("says when the range has no Sessions", async () => {
    fakeDashboardApi({ sessions: [aSession(daysAgo(50), 135)] });
    renderAt(`/history?${benchUrl}`, <DashboardsScreen />);

    expect(
      await screen.findByText("No Sessions in this range."),
    ).toBeInTheDocument();
  });

  it("keeps the Exercise and range when switching tabs", async () => {
    fakeDashboardApi({ sessions: [aSession(daysAgo(1), 135)] });
    renderAt(`/history?range=60d&${benchUrl}`, <DashboardsScreen />);

    await userEvent.click(screen.getByRole("radio", { name: "Meals" }));
    expect(url()).toHaveTextContent(`/history?tab=meals&range=60d&${benchUrl}`);
    await userEvent.click(screen.getByRole("radio", { name: "Exercise" }));

    expect(screen.getByRole("combobox", { name: "Exercise" })).toHaveValue(
      "Bench Press",
    );
    expect(
      await screen.findByRole("button", { name: "Top Set weight as a table" }),
    ).toBeInTheDocument();
  });

  it("shows a failed load as a Problem", async () => {
    fakeDashboardApi({});
    server.use(
      http.get("*/api/v1/exercises/:id/sessions", () =>
        HttpResponse.json({ title: "Not Found", status: 404 }, { status: 404 }),
      ),
    );
    renderAt(`/history?${benchUrl}`, <DashboardsScreen />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Not Found");
  });
});

describe("fetchSessions", () => {
  it("reads past the API's page of 200 by asking for Sessions before the oldest", async () => {
    const sessions = Array.from({ length: 450 }, (_, n) =>
      aSession(addDays("2026-11-15", -n), 135),
    );
    const api = fakeDashboardApi({ sessions });

    const all = await fetchSessions("e1", null, "2026-11-15");

    expect(all.map(({ day }) => day)).toEqual(sessions.map(({ day }) => day));
    expect(
      api.calls("/sessions").map((url) => url.searchParams.get("to")),
    ).toEqual(["2026-11-15", "2026-04-29", "2025-10-11"]);
  });
});
