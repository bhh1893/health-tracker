import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { addDays, formatDay, toDay } from "../lib/day";
import type { DayTotal } from "../nutrition/totals";
import type { ExerciseSession } from "../exercise/sessions";
import { aMeal, bench } from "../test-handlers";
import { renderAt } from "../test-render";
import { server } from "../test-server";
import { fetchSessions } from "../dashboards/queries";
import { HistoryScreen } from "./HistoryScreen";

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
// inclusive Day range and answers newest first.
function fakeDashboardApi({
  totals = [] as DayTotal[],
  sessions = [] as ExerciseSession[],
  restaurantDayKcal = 5000,
}) {
  const requests: URL[] = [];
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
          .map((total) =>
            total.restaurant_day
              ? { ...total, kcal: restaurantDayKcal }
              : total,
          ),
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
    // Recent Days, under the Dashboard on Meals. RecentDays.test.tsx covers it;
    // here it only needs an answer.
    http.get("*/api/v1/meal-days", () =>
      HttpResponse.json({ items: [], next_cursor: null }),
    ),
    http.get("*/api/v1/exercises/:id/sessions", ({ request }) => {
      const url = new URL(request.url);
      requests.push(url);
      const limit = Number(url.searchParams.get("limit"));
      return HttpResponse.json(
        sessions.filter(inRange(url)).toSorted(newestFirst).slice(0, limit),
      );
    }),
    http.get("*/api/v1/exercises", () => HttpResponse.json([bench])),
  );
  const calls = (path: string) =>
    requests.filter((url) => url.pathname.endsWith(path));
  return { calls };
}

const url = () => screen.getByLabelText("url");
const range = () => screen.getByRole("combobox", { name: "Range" });
const tile = (label: string) => {
  const term = screen.getByText(label, { selector: "dt" });
  // The tile is the <div> holding the label and its value.
  return term.parentElement ?? term;
};

// A chart's view switch: chart (the default) or table.
const viewSwitch = (title: string) =>
  screen.findByRole("radiogroup", { name: `${title} view` });

// The table view holds the same points as the chart's SVG, and reads as text, so
// that is what these tests read. TrendChart.test.tsx checks the marks themselves.
async function tableRows(title: string) {
  await userEvent.click(
    within(await viewSwitch(title)).getByRole("radio", { name: "table" }),
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

const dashboard = () => screen.getByRole("button", { name: /^Dashboard/ });
// The opened section. Recent Days below it says "No Meals in this range." too.
const dashboardPanel = () => screen.getByRole("group", { name: /^Dashboard/ });

describe("the History frame", () => {
  it("opens on Meals with the Dashboard closed, its average in the row", async () => {
    fakeDashboardApi({
      totals: [aTotal(daysAgo(1), { kcal: 2400 }), aTotal(daysAgo(2))],
    });
    renderAt("/history", <HistoryScreen />);

    expect(
      screen.getByRole("heading", { level: 1, name: "History" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Meals" })).toBeChecked();
    expect(range()).toHaveValue("30d");
    expect(dashboard()).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => {
      expect(dashboard()).toHaveAccessibleName("Dashboard, Avg 2,200 cal");
    });
    expect(
      screen.queryByRole("radiogroup", { name: "Calories per Day view" }),
    ).not.toBeInTheDocument();
  });

  it("opens Exercise for a link with an Exercise and no tab, naming it in the row", () => {
    fakeDashboardApi({});
    renderAt(`/history?${benchUrl}`, <HistoryScreen />);

    expect(screen.getByRole("radio", { name: "Exercise" })).toBeChecked();
    expect(screen.getByRole("combobox", { name: "Exercise" })).toHaveValue(
      "Bench Press",
    );
    expect(dashboard()).toHaveAccessibleName("Dashboard, Bench Press");
  });

  it("writes dash=open on opening, and drops it on closing", async () => {
    fakeDashboardApi({ totals: [aTotal(daysAgo(1))] });
    renderAt("/history", <HistoryScreen />);

    await userEvent.click(dashboard());

    expect(url()).toHaveTextContent(/^\/history\?dash=open$/);
    expect(dashboard()).toHaveAttribute("aria-expanded", "true");
    expect(await viewSwitch("Calories per Day")).toBeInTheDocument();

    await userEvent.click(dashboard());

    expect(url()).toHaveTextContent(/^\/history$/);
  });

  it("keeps the Dashboard open when switching kinds", async () => {
    fakeDashboardApi({ sessions: [aSession(daysAgo(1), 135)] });
    renderAt(`/history?tab=meals&${benchUrl}&dash=open`, <HistoryScreen />);

    await userEvent.click(screen.getByRole("radio", { name: "Exercise" }));

    expect(url()).toHaveTextContent(`/history?${benchUrl}&dash=open`);
    expect(await viewSwitch("Top Set weight")).toBeInTheDocument();
  });

  it("hides the Dashboard on Exercise until one is picked", () => {
    fakeDashboardApi({});
    renderAt("/history?tab=exercise&dash=open", <HistoryScreen />);

    expect(
      screen.getByText("Pick an Exercise to see its Sessions."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Dashboard/ }),
    ).not.toBeInTheDocument();
  });
});

describe("the Meals Dashboard", () => {
  it("charts calories per Day over the last 30 days", async () => {
    const api = fakeDashboardApi({
      totals: [
        aTotal(daysAgo(1), { kcal: 2400 }),
        aTotal(daysAgo(3), { kcal: 1600 }),
        aTotal(daysAgo(40)),
      ],
    });
    renderAt("/history?dash=open", <HistoryScreen />);

    expect(await tableRows("Calories per Day")).toEqual([
      [formatDay(daysAgo(1)), "2,400 cal", "P 150 g · C 200 g · F 60 g"],
      [formatDay(daysAgo(3)), "1,600 cal", "P 150 g · C 200 g · F 60 g"],
    ]);
    expect(tile("avg")).toHaveTextContent("2,000 cal");
    expect(tile("avg")).toHaveTextContent("2 days");
    const [request] = api.calls("/days");
    expect(request?.searchParams.get("from")).toBe(daysAgo(29));
    expect(request?.searchParams.get("to")).toBe(today);
  });

  it("charts a Restaurant Day at the flat value, and marks an Incomplete Day", async () => {
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
    renderAt("/history?dash=open", <HistoryScreen />);

    // The chart's legend names the orange point and the ring.
    await viewSwitch("Calories per Day");
    const legend = within(dashboardPanel()).getAllByRole("list")[0];
    expect(legend).toHaveTextContent(/^ate outincomplete$/);
    expect(tile("ate out")).toHaveTextContent("1");
    expect(tile("incomplete")).toHaveTextContent("1");

    const rows = await tableRows("Calories per Day");

    expect(rows[0]).toEqual([formatDay(daysAgo(1)), "5,000 cal", "ate out"]);
    expect(rows[1]).toEqual([
      formatDay(daysAgo(2)),
      "900 cal",
      "incomplete · P 150 g · C 200 g · F 60 g",
    ]);
  });

  it("asks for the range the chip names, and all of history without a start", async () => {
    const api = fakeDashboardApi({ totals: [aTotal(daysAgo(400))] });
    renderAt("/history?dash=open", <HistoryScreen />);
    await within(dashboardPanel()).findByText("No Meals in this range.");

    await userEvent.selectOptions(range(), "90 days");
    await waitFor(() => {
      expect(api.calls("/days").at(-1)?.searchParams.get("from")).toBe(
        daysAgo(89),
      );
    });
    expect(url()).toHaveTextContent("/history?range=90d&dash=open");

    await userEvent.selectOptions(range(), "All");

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

  it("says when nothing was logged", async () => {
    fakeDashboardApi({});
    renderAt("/history?dash=open", <HistoryScreen />);

    expect(
      await within(dashboardPanel()).findByText("No Meals in this range."),
    ).toBeInTheDocument();
  });
});

describe("the Exercise Dashboard", () => {
  it("asks for an Exercise first, then charts its top Set and volume", async () => {
    const api = fakeDashboardApi({
      sessions: [aSession(daysAgo(2), 145), aSession(daysAgo(9), 135)],
    });
    renderAt("/history?tab=exercise&range=90d&dash=open", <HistoryScreen />);
    expect(
      screen.getByText("Pick an Exercise to see its Sessions."),
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
    expect(url()).toHaveTextContent(`/history?range=90d&${benchUrl}&dash=open`);
    const request = api.calls("/sessions").at(-1);
    expect(request?.searchParams.get("from")).toBe(daysAgo(89));
    expect(request?.searchParams.get("to")).toBe(today);
  });

  it("charts a bodyweight Exercise by reps, with no volume", async () => {
    fakeDashboardApi({
      sessions: [aSession(daysAgo(1), null), aSession(daysAgo(5), null)],
    });
    renderAt(`/history?${benchUrl}&dash=open`, <HistoryScreen />);

    expect(await tableRows("Top Set reps")).toEqual([
      [formatDay(daysAgo(1)), "5 reps", "BW × 5, 2 Sets"],
      [formatDay(daysAgo(5)), "5 reps", "BW × 5, 2 Sets"],
    ]);
    expect(
      screen.queryByRole("radiogroup", { name: "Volume view" }),
    ).not.toBeInTheDocument();
  });

  it("says when the range has no Sessions", async () => {
    fakeDashboardApi({ sessions: [aSession(daysAgo(50), 135)] });
    renderAt(`/history?${benchUrl}&dash=open`, <HistoryScreen />);

    // Recent Days below says so too.
    expect(
      await within(dashboardPanel()).findByText("No Sessions in this range."),
    ).toBeInTheDocument();
  });

  it("keeps the Exercise and range when switching tabs", async () => {
    fakeDashboardApi({ sessions: [aSession(daysAgo(1), 135)] });
    renderAt(`/history?range=60d&${benchUrl}&dash=open`, <HistoryScreen />);

    await userEvent.click(screen.getByRole("radio", { name: "Meals" }));
    expect(url()).toHaveTextContent(
      `/history?tab=meals&range=60d&${benchUrl}&dash=open`,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Exercise" }));

    expect(screen.getByRole("combobox", { name: "Exercise" })).toHaveValue(
      "Bench Press",
    );
    expect(await viewSwitch("Top Set weight")).toBeInTheDocument();
  });

  it("shows a failed load as a Problem", async () => {
    fakeDashboardApi({});
    server.use(
      http.get("*/api/v1/exercises/:id/sessions", () =>
        HttpResponse.json({ title: "Not Found", status: 404 }, { status: 404 }),
      ),
    );
    renderAt(`/history?${benchUrl}&dash=open`, <HistoryScreen />);

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
