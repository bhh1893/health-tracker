import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { components } from "../api/schema";
import { addDays, toDay } from "../lib/day";
import { aMeal, aRestaurantMeal, banana, cafe, oats } from "../test-handlers";
import { renderAt } from "../test-render";
import { server } from "../test-server";
import { formatDayTitle } from "./dayTitle";
import { HistoryScreen } from "./HistoryScreen";

type MealDay = components["schemas"]["MealDay"];
type Food = components["schemas"]["Food"];

const today = toDay(new Date());
const daysAgo = (n: number) => addDays(today, -n);

const foodsDay = (day: string): MealDay => ({
  day,
  meals: [
    aMeal({
      id: `${day}-1`,
      day,
      food_entries: [
        { food: oats, quantity: 80, unit: "g" },
        { food: banana, quantity: 1, unit: "count" },
      ],
    }),
  ],
});

const restaurantDay = (day: string): MealDay => ({
  day,
  meals: [aRestaurantMeal([cafe], { id: `${day}-1`, day })],
});

// The Food and Restaurant names on a Day, which is what `q` matches.
const names = ({ meals }: MealDay) =>
  meals.flatMap((meal) =>
    meal.kind === "restaurant"
      ? meal.restaurants.map(({ name }) => name)
      : meal.food_entries.map((entry) => entry.food.name),
  );

// The Categories of a Day's Restaurants, which is what `category` matches.
const categories = ({ meals }: MealDay) =>
  meals.flatMap((meal) =>
    meal.kind === "restaurant"
      ? meal.restaurants.map(({ category }) => category)
      : [],
  );

// Stands in for GET /meal-days. Like the API it filters by the inclusive range, by
// `q` ignoring case and by `category`, answers newest first, and pages by whole Days. Its cursor
// is the last Day sent, which the screen must treat as opaque. Also answers the
// closed Dashboard's reads, and keeps them apart in `dashboard`.
function fakeMealDaysApi(days: MealDay[]) {
  const requests: URL[] = [];
  const dashboard: URL[] = [];
  server.use(
    http.get("*/api/v1/meal-days", ({ request }) => {
      const url = new URL(request.url);
      requests.push(url);
      const from = url.searchParams.get("from") ?? "";
      const to = url.searchParams.get("to") ?? "~";
      const cursor = url.searchParams.get("cursor") ?? "~";
      const q = url.searchParams.get("q")?.toLowerCase() ?? "";
      const category = url.searchParams.get("category");
      const limit = Number(url.searchParams.get("limit"));
      const kept = days
        .filter(({ day }) => day >= from && day <= to && day < cursor)
        .filter((day) =>
          names(day).some((name) => name.toLowerCase().includes(q)),
        )
        .filter(
          (day) =>
            category === null || categories(day).some((c) => c === category),
        )
        .toSorted((a, b) => b.day.localeCompare(a.day));
      const items = kept.slice(0, limit);
      return HttpResponse.json({
        items,
        next_cursor: kept.length > limit ? (items.at(-1)?.day ?? null) : null,
      });
    }),
    // The closed Dashboard's row reads the Range's average.
    http.get("*/api/v1/days", ({ request }) => {
      dashboard.push(new URL(request.url));
      return HttpResponse.json([]);
    }),
    http.get("*/api/v1/meals", ({ request }) => {
      dashboard.push(new URL(request.url));
      return HttpResponse.json({ items: [], next_cursor: null });
    }),
  );
  return Object.assign(requests, { dashboard });
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

const recentDays = () => screen.getByRole("region", { name: "Days" });
const rowButtons = () =>
  within(recentDays())
    .getAllByRole("heading", { level: 2 })
    .map((heading) => within(heading).getByRole("button"));

describe("Meals Recent Days", () => {
  it("lists each Day under its title, all closed, and opens one to its Foods", async () => {
    fakeMealDaysApi([foodsDay(daysAgo(1)), foodsDay(daysAgo(2))]);
    renderAt("/history", <HistoryScreen />);

    const newest = await screen.findByRole("button", {
      name: formatDayTitle(daysAgo(1)),
    });
    for (const row of rowButtons()) {
      expect(row).toHaveAttribute("aria-expanded", "false");
    }

    await userEvent.click(newest);
    expect(newest).toHaveAttribute("aria-expanded", "true");
    // A closed Day's list is hidden, so this is the open Day's Meal only: its
    // Foods on one line, without amounts.
    expect(
      within(recentDays())
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Oats · Banana"]);
  });

  it("offers the arrow to Home only on an open Day, and opens the Day there", async () => {
    const day = daysAgo(3);
    fakeMealDaysApi([foodsDay(day)]);
    renderAt("/history", <HistoryScreen />);

    const row = await screen.findByRole("button", {
      name: formatDayTitle(day),
    });
    const arrow = { name: `Open ${formatDayTitle(day)} on Home` };
    expect(screen.queryByRole("link", arrow)).toBeNull();

    await userEvent.click(row);
    await userEvent.click(screen.getByRole("link", arrow));
    expect(url()).toHaveTextContent(`/meals?day=${day}`);
  });

  it("gives each Meal of a Day its own line", async () => {
    const day = daysAgo(1);
    fakeMealDaysApi([
      {
        day,
        meals: [
          aMeal({
            id: `${day}-1`,
            day,
            food_entries: [
              { food: oats, quantity: 80, unit: "g" },
              { food: oats, quantity: 40, unit: "g" },
            ],
          }),
          aMeal({
            id: `${day}-2`,
            day,
            number: 2,
            food_entries: [{ food: banana, quantity: 1, unit: "count" }],
          }),
        ],
      },
    ]);
    renderAt("/history", <HistoryScreen />);

    await userEvent.click(
      await screen.findByRole("button", { name: formatDayTitle(day) }),
    );
    // The same Food twice in a Meal is listed twice.
    expect(
      within(recentDays())
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Oats · Oats", "Banana"]);
  });

  it("marks only a Restaurant Day as ate out, with its Restaurant", async () => {
    fakeMealDaysApi([restaurantDay(daysAgo(1)), foodsDay(daysAgo(2))]);
    renderAt("/history", <HistoryScreen />);

    expect(
      await screen.findByRole("button", {
        name: `${formatDayTitle(daysAgo(1))}, ate out`,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: formatDayTitle(daysAgo(2)) }),
    ).toBeInTheDocument();
    expect(
      within(recentDays()).getAllByRole("button", { name: /, ate out$/ }),
    ).toHaveLength(1);
    expect(within(recentDays()).getByText(cafe.name)).toBeInTheDocument();
  });

  it("asks for the next cursor as the end scrolls into view, and stops at the last page", async () => {
    endAlwaysInView();
    const days = Array.from({ length: 45 }, (_, n) => foodsDay(daysAgo(n)));
    const requests = fakeMealDaysApi(days);
    renderAt("/history?range=60d", <HistoryScreen />);

    await waitFor(() => {
      expect(rowButtons()).toHaveLength(45);
    });
    expect(requests.map((url) => url.searchParams.get("cursor"))).toEqual([
      null,
      daysAgo(19),
      daysAgo(39),
    ]);
    expect(
      within(recentDays()).queryByRole("button", { name: "Load more" }),
    ).not.toBeInTheDocument();
    expect(within(recentDays()).getByRole("status")).toHaveTextContent(
      "Loaded 5 more Days, the last in this range.",
    );
  });

  it("loads the next page from the Load more button too", async () => {
    fakeMealDaysApi(Array.from({ length: 25 }, (_, n) => foodsDay(daysAgo(n))));
    renderAt("/history", <HistoryScreen />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Load more" }),
    );

    await waitFor(() => {
      expect(rowButtons()).toHaveLength(25);
    });
  });

  it("starts over from the first page when the Range changes", async () => {
    const requests = fakeMealDaysApi(
      Array.from({ length: 25 }, (_, n) => foodsDay(daysAgo(n * 3))),
    );
    renderAt("/history?range=1y", <HistoryScreen />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Load more" }),
    );
    await waitFor(() => {
      expect(requests).toHaveLength(2);
    });

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Range" }),
      "All",
    );

    await waitFor(() => {
      expect(requests).toHaveLength(3);
    });
    const last = requests.at(-1);
    expect(last?.searchParams.get("cursor")).toBeNull();
    // All of history: no start at all, not an early one.
    expect(last?.searchParams.has("from")).toBe(false);
    expect(last?.searchParams.get("to")).toBe(today);
    expect(rowButtons()).toHaveLength(20);
  });

  it("says so when the Range has no Meals", async () => {
    fakeMealDaysApi([foodsDay(daysAgo(40))]);
    renderAt("/history", <HistoryScreen />);

    expect(
      await within(recentDays()).findByText("No Meals in this range."),
    ).toBeInTheDocument();
  });

  it("offers a retry when a page fails", async () => {
    fakeMealDaysApi([foodsDay(daysAgo(1))]);
    let fail = true;
    server.use(
      http.get("*/api/v1/meal-days", () =>
        fail
          ? HttpResponse.json(
              { title: "Unprocessable Content", status: 422 },
              { status: 422 },
            )
          : undefined,
      ),
    );
    renderAt("/history", <HistoryScreen />);

    const retry = await screen.findByRole("button", { name: "Try again" });
    fail = false;
    await userEvent.click(retry);

    expect(
      await screen.findByRole("button", { name: formatDayTitle(daysAgo(1)) }),
    ).toBeInTheDocument();
  });
});

const chicken: Food = { ...oats, id: "chicken", name: "Chicken breast" };
const shack = { ...cafe, id: "shack", name: "BBQ Chicken Shack" };

const chickenDay = (day: string): MealDay => ({
  day,
  meals: [
    aMeal({
      id: `${day}-1`,
      day,
      food_entries: [
        { food: oats, quantity: 80, unit: "g" },
        { food: chicken, quantity: 200, unit: "g" },
      ],
    }),
  ],
});

const shackDay = (day: string): MealDay => ({
  day,
  meals: [aRestaurantMeal([cafe, shack], { id: `${day}-1`, day })],
});

const filter = () => screen.getByRole("searchbox", { name: "Filter Days" });
const url = () => screen.getByLabelText("url");
const marks = () =>
  Array.from(recentDays().querySelectorAll("mark"), (mark) => mark.textContent);

describe("the Meals filter", () => {
  it("keeps only the Days with a matching Food or Restaurant, and leaves the Dashboard alone", async () => {
    const requests = fakeMealDaysApi([
      chickenDay(daysAgo(1)),
      foodsDay(daysAgo(2)),
      shackDay(daysAgo(3)),
    ]);
    renderAt("/history", <HistoryScreen />);
    await waitFor(() => {
      expect(rowButtons()).toHaveLength(3);
    });

    await userEvent.type(filter(), "chicken");

    await waitFor(() => {
      expect(rowButtons()).toHaveLength(2);
    });
    expect(url()).toHaveTextContent(/^\/history\?q=chicken$/);
    expect(requests.at(-1)?.searchParams.get("q")).toBe("chicken");
    expect(requests.at(-1)?.searchParams.get("cursor")).toBeNull();
    expect(
      within(recentDays()).getByText(
        'Days with a Food or Restaurant matching "chicken"',
        { exact: false },
      ),
    ).toHaveTextContent(/^2 Days with/);
    // The filter never narrows the Dashboard (ADR 0033).
    expect(requests.dashboard.length).toBeGreaterThan(0);
    for (const request of requests.dashboard) {
      expect(request.searchParams.has("q")).toBe(false);
    }
  });

  it("opens a filtered link on its Days, every match marked whatever its case", async () => {
    fakeMealDaysApi([
      chickenDay(daysAgo(1)),
      foodsDay(daysAgo(2)),
      shackDay(daysAgo(3)),
    ]);
    renderAt("/history?q=CHICKEN", <HistoryScreen />);

    await waitFor(() => {
      expect(rowButtons()).toHaveLength(2);
    });
    expect(filter()).toHaveValue("CHICKEN");
    // An opened Day shows all of its Foods, not only the match.
    await userEvent.click(
      screen.getByRole("button", { name: formatDayTitle(daysAgo(1)) }),
    );
    expect(
      within(recentDays())
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Oats · Chicken breast"]);
    await userEvent.click(
      screen.getByRole("button", {
        name: `${formatDayTitle(daysAgo(3))}, ate out`,
      }),
    );
    // Every Restaurant of the Meal, in order, and the match is in the second.
    expect(
      within(recentDays()).getAllByRole("listitem").at(-1)?.textContent,
    ).toBe("Corner Cafe · BBQ Chicken Shack");
    expect(marks()).toEqual(["Chicken", "Chicken"]);
  });

  it("counts the Days loaded so far, with + while more remain", async () => {
    fakeMealDaysApi(
      Array.from({ length: 25 }, (_, n) => chickenDay(daysAgo(n))),
    );
    renderAt("/history?q=chicken", <HistoryScreen />);

    expect(
      await within(recentDays()).findByText(
        '20+ Days with a Food or Restaurant matching "chicken"',
      ),
    ).toBeInTheDocument();

    await userEvent.click(
      within(recentDays()).getByRole("button", { name: "Load more" }),
    );

    expect(
      await within(recentDays()).findByText(
        '25 Days with a Food or Restaurant matching "chicken"',
      ),
    ).toBeInTheDocument();
  });

  it("says so when nothing matches", async () => {
    fakeMealDaysApi([foodsDay(daysAgo(1))]);
    renderAt("/history?q=tofu", <HistoryScreen />);

    expect(
      await within(recentDays()).findByText(
        'No Days with a Food or Restaurant matching "tofu".',
      ),
    ).toBeInTheDocument();
  });

  it("restores every Day when cleared", async () => {
    fakeMealDaysApi([chickenDay(daysAgo(1)), foodsDay(daysAgo(2))]);
    renderAt("/history?q=chicken&range=60d", <HistoryScreen />);
    await waitFor(() => {
      expect(rowButtons()).toHaveLength(1);
    });

    await userEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(filter()).toHaveValue("");
    expect(url()).toHaveTextContent(/^\/history\?range=60d$/);
    await waitFor(() => {
      expect(rowButtons()).toHaveLength(2);
    });
    expect(marks()).toEqual([]);
    expect(
      within(recentDays()).queryByText(/matching/),
    ).not.toBeInTheDocument();
  });
});

describe("Restaurant Categories", () => {
  const bar = {
    id: "0190a000-0000-7000-8000-000000000202",
    name: "Corner Bar",
    archived: false,
    category: "drinks" as const,
  };
  const gelato = {
    id: "0190a000-0000-7000-8000-000000000203",
    name: "Gelato Stand",
    archived: false,
    category: "dessert" as const,
  };
  // Dinner, then drinks, as one Meal (ADR 0034).
  const nightOut = (day: string): MealDay => ({
    day,
    meals: [aRestaurantMeal([cafe, bar], { id: `${day}-1`, day })],
  });
  const dessertDay = (day: string): MealDay => ({
    day,
    meals: [aRestaurantMeal([gelato], { id: `${day}-1`, day })],
  });

  it("badges a Day with each of its Categories, in a fixed order", async () => {
    fakeMealDaysApi([nightOut(daysAgo(1)), dessertDay(daysAgo(2))]);
    renderAt("/history", <HistoryScreen />);

    expect(
      await screen.findByRole("button", {
        name: `${formatDayTitle(daysAgo(1))}, ate out, drinks`,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: `${formatDayTitle(daysAgo(2))}, dessert`,
      }),
    ).toBeInTheDocument();
  });

  it("names a Restaurant's Category to a screen reader, unless it is ate out", async () => {
    fakeMealDaysApi([nightOut(daysAgo(1))]);
    renderAt("/history", <HistoryScreen />);

    await userEvent.click(
      await screen.findByRole("button", { name: /, ate out, drinks$/ }),
    );

    expect(
      within(recentDays()).getAllByRole("listitem").at(-1)?.textContent,
    ).toBe("Corner Cafe · Corner Bar (drinks)");
  });

  it("keeps only the Days with a Restaurant of the chosen chip, and clears on a second tap", async () => {
    const requests = fakeMealDaysApi([
      nightOut(daysAgo(1)),
      dessertDay(daysAgo(2)),
      foodsDay(daysAgo(3)),
    ]);
    renderAt("/history", <HistoryScreen />);
    await screen.findByRole("button", { name: /, dessert$/ });
    const chips = screen.getByRole("group", { name: "Restaurant Category" });

    await userEvent.click(
      within(chips).getByRole("button", { name: "Drinks" }),
    );

    await waitFor(() => {
      expect(rowButtons()).toHaveLength(1);
    });
    expect(rowButtons()[0]).toHaveAccessibleName(/, ate out, drinks$/);
    expect(requests.at(-1)?.searchParams.get("category")).toBe("drinks");
    expect(within(recentDays()).getByText("1 Day with drinks")).toBeVisible();

    await userEvent.click(
      within(chips).getByRole("button", { name: "Drinks" }),
    );

    await waitFor(() => {
      expect(rowButtons()).toHaveLength(3);
    });
    // From the cache: the unfiltered list was already loaded.
    expect(
      within(chips).getByRole("button", { name: "Drinks" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("opens a link with a Category and a filter on the Days that match both", async () => {
    const requests = fakeMealDaysApi([
      nightOut(daysAgo(1)),
      dessertDay(daysAgo(2)),
    ]);
    renderAt("/history?q=gelato&category=drinks", <HistoryScreen />);

    expect(
      await within(recentDays()).findByText(
        'No Days with a Food or Restaurant matching "gelato" and with drinks.',
      ),
    ).toBeInTheDocument();
    expect(requests.at(-1)?.searchParams.get("category")).toBe("drinks");
    expect(
      within(
        screen.getByRole("group", { name: "Restaurant Category" }),
      ).getByRole("button", { name: "Drinks" }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});
