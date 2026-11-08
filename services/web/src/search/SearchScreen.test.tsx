import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { components } from "../api/schema";
import type { ExerciseEntry } from "../exercise/sessions";
import { addDays, formatDay, toDay } from "../lib/day";
import type { Meal } from "../meals/meals";
import { aMeal, aSet, banana, bench, oats } from "../test-handlers";
import { renderAt } from "../test-render";
import { server } from "../test-server";
import { SearchScreen } from "./SearchScreen";

type CatalogRef = components["schemas"]["CatalogRef"];
type ExerciseSession = components["schemas"]["ExerciseSession"];

const today = toDay(new Date());
const daysAgo = (n: number) => addDays(today, -n);

const setOn = (day: string, n: number, fields: Partial<ExerciseEntry> = {}) =>
  aSet({
    id: `set-${day}-${String(n)}`,
    day,
    number: n,
    occurred_at: `${day}T18:0${String(n)}:00+13:00`,
    ...fields,
  });

const mealOn = (day: string, foods: CatalogRef[], n = 1) =>
  aMeal({
    id: `meal-${day}-${String(n)}`,
    day,
    number: n,
    occurred_at: `${day}T0${String(n)}:00:00+13:00`,
    food_entries: foods.map((food) => ({ food, quantity: 1, unit: "count" })),
  });

const archivedSquat: CatalogRef = {
  id: "0190a000-0000-7000-8000-000000000003",
  name: "Squat",
  archived: true,
};

// Newest first on (day, occurred_at, id), the API's keyset order (ADR 0006).
function newestFirst<
  T extends { day: string; occurred_at: string; id: string },
>(a: T, b: T) {
  return (
    b.day.localeCompare(a.day) ||
    b.occurred_at.localeCompare(a.occurred_at) ||
    b.id.localeCompare(a.id)
  );
}

// A stand-in for the range collections that really pages: it honours from, to, the
// Catalog filter, limit and cursor, so the screen's paging is tested end to end.
// Its cursor is a plain offset; the screen treats cursors as opaque either way.
function fakeSearchApi({
  entries = [] as ExerciseEntry[],
  meals = [] as Meal[],
  sessions = [] as ExerciseSession[],
}) {
  const requests: URL[] = [];
  function page<T extends { day: string; occurred_at: string; id: string }>(
    all: T[],
    url: URL,
    matches: (item: T, id: string) => boolean,
  ) {
    requests.push(url);
    const query = url.searchParams;
    const from = query.get("from") ?? "";
    const to = query.get("to") ?? "~";
    const id = query.get("exercise_id") ?? query.get("food_id");
    const limit = Number(query.get("limit") ?? 50);
    const start = Number(query.get("cursor") ?? 0);
    const found = all
      .filter((item) => item.day >= from && item.day <= to)
      .filter((item) => id === null || matches(item, id))
      .toSorted(newestFirst);
    const end = start + limit;
    return {
      items: found.slice(start, end),
      next_cursor: end < found.length ? String(end) : null,
    };
  }
  const search = (items: CatalogRef[], request: Request) => {
    const q = new URL(request.url).searchParams.get("q") ?? "";
    return items.filter(({ name }) =>
      name.toLowerCase().includes(q.toLowerCase()),
    );
  };

  const handlers = [
    http.get("*/api/v1/exercise-entries", ({ request }) =>
      HttpResponse.json(
        page(
          entries,
          new URL(request.url),
          (entry, id) => entry.exercise.id === id,
        ),
      ),
    ),
    http.get("*/api/v1/meals", ({ request }) =>
      HttpResponse.json(
        page(
          meals,
          new URL(request.url),
          (meal, id) =>
            meal.kind === "foods" &&
            meal.food_entries.some(({ food }) => food.id === id),
        ),
      ),
    ),
    http.get("*/api/v1/exercises/:id/sessions", ({ request }) => {
      requests.push(new URL(request.url));
      const limit = Number(new URL(request.url).searchParams.get("limit"));
      return HttpResponse.json(sessions.slice(0, limit));
    }),
    http.get("*/api/v1/exercises", ({ request }) => {
      requests.push(new URL(request.url));
      return HttpResponse.json(search([bench, archivedSquat], request));
    }),
    http.get("*/api/v1/foods", ({ request }) =>
      HttpResponse.json(search([oats, banana], request)),
    ),
  ];
  server.use(...handlers);

  const calls = (path: string) =>
    requests.filter((url) => url.pathname === path);
  return { calls };
}

const dayRows = () => screen.queryAllByRole("heading", { level: 3 });
const url = () => screen.getByLabelText("url");

async function pick(label: string, text: string, option: string) {
  const box = screen.getByRole("combobox", { name: label });
  await userEvent.type(box, text);
  await userEvent.click(await screen.findByRole("option", { name: option }));
}

beforeEach(() => {
  fakeSearchApi({});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("searching by Food", () => {
  it("shows the Days a Food was eaten, and only after one is picked", async () => {
    const api = fakeSearchApi({
      meals: [
        mealOn(daysAgo(1), [oats]),
        mealOn(daysAgo(2), [banana]),
        mealOn(daysAgo(3), [oats, banana]),
      ],
    });
    renderAt("/search", <SearchScreen />);
    await userEvent.click(screen.getByRole("radio", { name: "Food" }));

    expect(screen.getByText("Pick a Food to see results.")).toBeInTheDocument();
    await pick("Food", "oat", "Oats");

    await waitFor(() => {
      expect(dayRows()).toHaveLength(2);
    });
    for (const day of [daysAgo(1), daysAgo(3)]) {
      expect(
        screen.getByRole("button", { name: `${formatDay(day)}, 1 meal` }),
      ).toBeInTheDocument();
    }
    expect(api.calls("/api/v1/meals").at(-1)?.searchParams.get("food_id")).toBe(
      oats.id,
    );
  });

  it("never offers to create, and says when nothing matches", async () => {
    renderAt("/search?what=food", <SearchScreen />);

    await userEvent.type(screen.getByRole("combobox", { name: "Food" }), "zzz");

    expect(await screen.findByText("No match")).toBeInTheDocument();
    expect(screen.queryByText(/Create/)).not.toBeInTheDocument();
  });

  it("clears the results when the picked text is edited", async () => {
    fakeSearchApi({ meals: [mealOn(daysAgo(1), [oats])] });
    renderAt("/search?what=food", <SearchScreen />);
    await pick("Food", "oat", "Oats");
    await waitFor(() => {
      expect(dayRows()).toHaveLength(1);
    });

    await userEvent.type(screen.getByRole("combobox", { name: "Food" }), "x");

    expect(dayRows()).toHaveLength(0);
    expect(url()).not.toHaveTextContent("id=");
  });
});

describe("searching by Exercise", () => {
  it("summarizes each Day and opens it in the Exercise window", async () => {
    fakeSearchApi({
      entries: [setOn(daysAgo(2), 1, { weight_lb: 145 }), setOn(daysAgo(2), 2)],
    });
    renderAt("/search?what=exercise", <SearchScreen />);
    await pick("Exercise", "ben", "Bench Press");

    const row = await screen.findByRole("button", {
      name: `${formatDay(daysAgo(2))}, 2 sets, top 145 lb × 5`,
    });
    await userEvent.click(row);
    const session = screen.getByRole("article", { name: "Bench Press" });
    expect(within(session).getAllByRole("listitem")).toHaveLength(2);

    await userEvent.click(
      screen.getByRole("link", { name: "Open in Exercise" }),
    );
    expect(url()).toHaveTextContent(`/exercise?day=${daysAgo(2)}`);
  });

  it("finds archived Exercises, since their history is real", async () => {
    const api = fakeSearchApi({});
    renderAt("/search?what=exercise", <SearchScreen />);

    await userEvent.type(
      screen.getByRole("combobox", { name: "Exercise" }),
      "squ",
    );

    expect(
      await screen.findByRole("option", { name: "Squat (archived)" }),
    ).toBeInTheDocument();
    expect(
      api
        .calls("/api/v1/exercises")
        .at(-1)
        ?.searchParams.get("include_archived"),
    ).toBe("true");
  });

  it("shows the last N Sessions as a table, N from the stepper", async () => {
    const api = fakeSearchApi({
      sessions: [
        {
          day: daysAgo(1),
          sets: [
            { number: 1, reps: 5, weight_lb: 135 },
            { number: 2, reps: 5, weight_lb: 145 },
          ],
        },
        { day: daysAgo(4), sets: [{ number: 1, reps: 10, weight_lb: null }] },
      ],
    });
    renderAt(
      `/search?what=exercise&id=${bench.id}&name=Bench+Press&view=sessions`,
      <SearchScreen />,
    );

    const rows = await screen.findAllByRole("row");
    expect(rows.map((row) => row.textContent)).toEqual([
      "DaySetsTop setVolume",
      `${formatDay(daysAgo(1))}2145 lb × 51,400 lb`,
      `${formatDay(daysAgo(4))}1BW × 10BW`,
    ]);

    await userEvent.click(screen.getByRole("button", { name: /Increase/ }));
    await waitFor(() => {
      expect(
        api
          .calls(`/api/v1/exercises/${bench.id}/sessions`)
          .map((call) => call.searchParams.get("limit")),
      ).toEqual(["5", "6"]);
    });
  });
});

describe("Everything, a screen at a time", () => {
  // 20 Days of 3 Sets and 1 Meal: 60 Sets is more than one page of 50.
  function seedMonth() {
    const days = Array.from({ length: 20 }, (_, i) => daysAgo(i));
    return fakeSearchApi({
      entries: days.flatMap((day) => [1, 2, 3].map((n) => setOn(day, n))),
      meals: days.map((day) => mealOn(day, [oats])),
    });
  }

  it("never shows a Day before all of it has loaded", async () => {
    seedMonth();
    renderAt("/search", <SearchScreen />);

    await screen.findByRole("button", { name: "Load more" });
    // The first page of Sets ends partway through a Day; that Day waits.
    expect(dayRows().length).toBeGreaterThanOrEqual(15);
    expect(dayRows().length).toBeLessThan(20);
    for (const row of dayRows()) {
      expect(row).toHaveTextContent("3 sets, top 135 lb × 5, 1 meal");
    }
  });

  it("loads the next page on Load more, then stops at the end", async () => {
    const api = seedMonth();
    renderAt("/search", <SearchScreen />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Load more" }),
    );

    await waitFor(() => {
      expect(dayRows()).toHaveLength(20);
    });
    expect(
      api
        .calls("/api/v1/exercise-entries")
        .map((call) => call.searchParams.get("cursor")),
    ).toEqual([null, "50"]);
    expect(
      screen.queryByRole("button", { name: "Load more" }),
    ).not.toBeInTheDocument();
  });

  it("loads more by itself when the end of the list scrolls into view", async () => {
    // jsdom has no layout, so stand in an observer that always sees its target.
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
    seedMonth();
    renderAt("/search", <SearchScreen />);

    await waitFor(() => {
      expect(dayRows()).toHaveLength(20);
    });
  });

  it("offers a retry when a page fails", async () => {
    let fail = true;
    server.use(
      http.get("*/api/v1/meals", () =>
        fail
          ? HttpResponse.json(
              { title: "Unprocessable Content", status: 422 },
              { status: 422 },
            )
          : HttpResponse.json({ items: [], next_cursor: null }),
      ),
    );
    renderAt("/search", <SearchScreen />);

    const retry = await screen.findByRole("button", { name: "Try again" });
    fail = false;
    await userEvent.click(retry);

    expect(
      await screen.findByText("Nothing logged in this range."),
    ).toBeInTheDocument();
  });
});

describe("the question lives in the URL", () => {
  it("writes each choice to the URL and reads it back on load", async () => {
    fakeSearchApi({ meals: [mealOn(daysAgo(1), [oats])] });
    renderAt("/search?what=food", <SearchScreen />);
    await pick("Food", "oat", "Oats");
    await userEvent.click(screen.getByRole("radio", { name: "7 days" }));

    expect(url()).toHaveTextContent(
      `/search?what=food&id=${oats.id}&name=Oats&range=7d`,
    );
  });

  it("returns to the window it came from", () => {
    renderAt("/search", <SearchScreen />);
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute(
      "href",
      "/exercise",
    );
  });
});
