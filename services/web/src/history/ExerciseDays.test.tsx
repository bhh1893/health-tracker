import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { components } from "../api/schema";
import { addDays, toDay } from "../lib/day";
import type { ExerciseSession } from "../search/days";
import { bench } from "../test-handlers";
import { renderAt } from "../test-render";
import { server } from "../test-server";
import { formatDayTitle } from "./dayTitle";
import { HistoryScreen } from "./HistoryScreen";

type CatalogRef = components["schemas"]["CatalogRef"];

const today = toDay(new Date());
const daysAgo = (n: number) => addDays(today, -n);

const squat: CatalogRef = {
  id: "0190a000-0000-7000-8000-000000000002",
  name: "Squat",
  archived: false,
};

const aSession = (
  day: string,
  weights: (number | null)[],
): ExerciseSession => ({
  day,
  sets: weights.map((weight_lb, index) => ({
    number: index + 1,
    reps: 5,
    weight_lb,
  })),
});

// Stands in for the endpoints the Exercise side reads. Like the API, the Sessions
// endpoint filters by the inclusive Day range, answers newest first and stops at
// `limit` Days. The recent list (empty q) is Bench Press, then Squat.
function fakeExerciseApi(sessions: ExerciseSession[]) {
  const requests: URL[] = [];
  server.use(
    http.get("*/api/v1/exercises/:id/sessions", ({ request }) => {
      const url = new URL(request.url);
      requests.push(url);
      const from = url.searchParams.get("from") ?? "";
      const to = url.searchParams.get("to") ?? "~";
      const limit = Number(url.searchParams.get("limit"));
      return HttpResponse.json(
        sessions
          .filter(({ day }) => day >= from && day <= to)
          .toSorted((a, b) => b.day.localeCompare(a.day))
          .slice(0, limit),
      );
    }),
    http.get("*/api/v1/exercises", () => HttpResponse.json([bench, squat])),
  );
  return requests;
}

// jsdom has no layout, so stand in an observer that always sees its target, as if
// the end of the list were on screen.
function endAlwaysInView() {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(
        private readonly callback: (
          entries: { isIntersecting: boolean }[],
        ) => void,
      ) {}
      observe() {
        this.callback([{ isIntersecting: true }]);
      }
      disconnect = vi.fn();
    },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const url = () => screen.getByLabelText("url");
const picker = () => screen.getByRole("combobox", { name: "Exercise" });
const prompt = "Pick an Exercise to see its Sessions.";
const recentDays = () => screen.getByRole("region", { name: "Recent Days" });
const rowButtons = () =>
  within(recentDays())
    .getAllByRole("heading", { level: 3 })
    .map((heading) => within(heading).getByRole("button"));
const benchUrl = `id=${bench.id}&name=Bench+Press`;

describe("Exercise with nothing picked", () => {
  it("shows only the picker, recent chips and the prompt, and reads no Sessions", async () => {
    const requests = fakeExerciseApi([aSession(daysAgo(1), [135])]);
    renderAt("/history?tab=exercise&dash=open", <HistoryScreen />);

    const chips = await screen.findByRole("group", {
      name: "Recent Exercises",
    });
    expect(
      within(chips)
        .getAllByRole("button")
        .map((chip) => chip.textContent),
    ).toEqual(["Bench Press", "Squat"]);
    expect(picker()).toHaveValue("");
    expect(screen.getByText(prompt)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Dashboard/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Recent Days" }),
    ).not.toBeInTheDocument();
    expect(requests).toEqual([]);
  });

  it("picks an Exercise from a chip, writing id and name", async () => {
    fakeExerciseApi([aSession(daysAgo(1), [135])]);
    renderAt("/history?tab=exercise", <HistoryScreen />);

    await userEvent.click(await screen.findByRole("button", { name: "Squat" }));

    expect(url()).toHaveTextContent(`/history?id=${squat.id}&name=Squat`);
    expect(picker()).toHaveValue("Squat");
    expect(screen.queryByText(prompt)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "Recent Exercises" }),
    ).not.toBeInTheDocument();
  });
});

describe("Exercise Recent Days", () => {
  it("lists each Day with a Session, the newest open with its Sets", async () => {
    fakeExerciseApi([
      aSession(daysAgo(2), [135, 135, null]),
      aSession(daysAgo(6), [125]),
    ]);
    renderAt(`/history?${benchUrl}`, <HistoryScreen />);

    const newest = await screen.findByRole("button", {
      name: formatDayTitle(daysAgo(2)),
    });
    expect(newest).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("button", { name: formatDayTitle(daysAgo(6)) }),
    ).toHaveAttribute("aria-expanded", "false");
    // A closed Day's list is hidden, so these are the open Day's Sets only.
    expect(
      within(recentDays())
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Set 15 reps · 135 lb",
      "Set 25 reps · 135 lb",
      "Set 35 reps · BW",
    ]);
  });

  it("follows the Range", async () => {
    const requests = fakeExerciseApi([
      aSession(daysAgo(1), [135]),
      aSession(daysAgo(50), [125]),
    ]);
    renderAt(`/history?${benchUrl}`, <HistoryScreen />);
    await waitFor(() => {
      expect(rowButtons()).toHaveLength(1);
    });
    expect(requests.at(-1)?.searchParams.get("from")).toBe(daysAgo(29));

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Range" }),
      "60 days",
    );

    await waitFor(() => {
      expect(rowButtons()).toHaveLength(2);
    });
    const last = requests.at(-1);
    expect(last?.searchParams.get("from")).toBe(daysAgo(59));
    expect(last?.searchParams.get("to")).toBe(today);
  });

  it("pages by asking for one Session more, and starts the next page at it", async () => {
    endAlwaysInView();
    const requests = fakeExerciseApi(
      Array.from({ length: 45 }, (_, n) => aSession(daysAgo(n), [135])),
    );
    renderAt(`/history?range=60d&${benchUrl}`, <HistoryScreen />);

    await waitFor(() => {
      expect(rowButtons()).toHaveLength(45);
    });
    // The 21st Session of each answer is the next page's first, so three
    // requests and no empty one at the end.
    expect(
      requests.map((request) => [
        request.searchParams.get("to"),
        request.searchParams.get("limit"),
      ]),
    ).toEqual([
      [today, "21"],
      [daysAgo(20), "21"],
      [daysAgo(40), "21"],
    ]);
    expect(within(recentDays()).getByRole("status")).toHaveTextContent(
      "Loaded 5 more Days, the last in this range.",
    );
  });

  it("clears the pick with ×, back to the chips and the prompt", async () => {
    fakeExerciseApi([aSession(daysAgo(1), [135])]);
    renderAt(`/history?range=90d&${benchUrl}&dash=open`, <HistoryScreen />);
    await screen.findByRole("button", { name: formatDayTitle(daysAgo(1)) });

    await userEvent.click(screen.getByRole("button", { name: "Clear" }));

    // `tab` is written now: with no Exercise, the reader would open Meals.
    expect(url()).toHaveTextContent(
      /^\/history\?tab=exercise&range=90d&dash=open$/,
    );
    expect(picker()).toHaveValue("");
    expect(screen.getByText(prompt)).toBeInTheDocument();
    expect(
      await screen.findByRole("group", { name: "Recent Exercises" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Recent Days" }),
    ).not.toBeInTheDocument();
  });
});
