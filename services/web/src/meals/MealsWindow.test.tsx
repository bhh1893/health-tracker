import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { App } from "../App";
import type { RestaurantRef } from "../catalog/catalogs";
import {
  aMeal,
  aRestaurantMeal,
  banana,
  cafe,
  fakeMealApi,
  oats,
  RESTAURANT_DAY_KCAL,
  signedInAs,
} from "../test-handlers";
import { renderAt } from "../test-render";
import { server } from "../test-server";
import type { Meal } from "./meals";
import { MealsWindow } from "./MealsWindow";

const PAST_DAY = "2026-11-02";
const PAST_URL = `/meals?day=${PAST_DAY}`;

let api: ReturnType<typeof fakeMealApi>;

function seedApi(...seed: Meal[]) {
  api = fakeMealApi(seed);
  server.use(...api.handlers);
}

// For a Restaurant Catalog beyond the one `cafe`.
function seedRestaurants(restaurants: RestaurantRef[], ...seed: Meal[]) {
  api = fakeMealApi(seed, undefined, restaurants);
  server.use(...api.handlers);
}

const aRestaurant = (n: number, name: string): RestaurantRef => ({
  id: `0190a000-0000-7000-8000-0000000002${String(n).padStart(2, "0")}`,
  name,
  archived: false,
  category: "ate_out",
});
const tacos = aRestaurant(2, "Taco Stand");
const noodles = aRestaurant(3, "Noodle Bar");

beforeEach(() => {
  seedApi();
});

const sheet = () => screen.getByRole("dialog");
const card = (name: string) => screen.findByRole("article", { name });
const restaurantNames = () =>
  within(within(sheet()).getByRole("list", { name: "Restaurants" }))
    .getAllByRole("listitem")
    .map((item) => item.getAttribute("aria-label"));
const recentRestaurant = async (name: string) =>
  within(
    await within(sheet()).findByRole("group", { name: "Recent Restaurants" }),
  ).getByRole("button", { name });
const foodRow = (name: string) =>
  within(within(sheet()).getByRole("list", { name: "Foods" })).getByRole(
    "listitem",
    { name },
  );

async function openNewMeal(button: "Add Food" | "Add Restaurant" = "Add Food") {
  await screen.findByText("No Meals on this Day.");
  await userEvent.click(screen.getByRole("button", { name: button }));
}

async function searchAndAdd(name: string) {
  await userEvent.type(
    within(sheet()).getByRole("combobox", { name: "Add Food" }),
    name,
  );
  await userEvent.click(await screen.findByRole("option", { name }));
  // findBy, not getBy: until the suggestions finish closing, react-aria hides the
  // rest of the sheet from assistive tech, so Add is briefly not found.
  await userEvent.click(
    await within(sheet()).findByRole("button", { name: "Add" }),
  );
}

describe("the Day feed", () => {
  it("names each Meal by its Label, or Meal without one, in time order", async () => {
    seedApi(
      aRestaurantMeal([cafe], {
        id: "b",
        occurred_at: "2026-11-02T13:00:00+13:00",
      }),
      aMeal({ id: "a", label: "Breakfast" }),
    );
    renderAt(PAST_URL, <MealsWindow />);

    const first = await card("Breakfast");
    expect(first).toHaveTextContent("Oats80 g");
    // The time is stored and orders the feed, but the card does not show it.
    expect(first).not.toHaveTextContent("08:00");
    expect(await card("Meal")).toHaveTextContent("Corner Cafe");
    expect(
      screen.getAllByRole("article").map((article) => article.ariaLabel),
    ).toEqual(["Breakfast", "Meal"]);
  });

  it("says so when the Day is empty", async () => {
    renderAt(PAST_URL, <MealsWindow />);

    expect(
      await screen.findByText("No Meals on this Day."),
    ).toBeInTheDocument();
  });
});

describe("the Day total", () => {
  const dayTotal = () => screen.findByRole("region", { name: "Day total" });

  it("shows a complete Day's calories and macros, with no badge", async () => {
    seedApi(
      aMeal({
        total: {
          kcal: 2130,
          protein_g: 120,
          carbs_g: 250,
          fat_g: 70,
          incomplete: false,
        },
      }),
    );
    renderAt(PAST_URL, <MealsWindow />);

    const total = await dayTotal();
    expect(total).toHaveTextContent("2,130 cal");
    expect(total).toHaveTextContent("P 120 g · C 250 g · F 70 g");
    expect(total).not.toHaveTextContent("Incomplete");
    expect(total).not.toHaveTextContent("ate out");
  });

  it("badges an Incomplete Day and says the real total is higher", async () => {
    // aMeal's Oats has no Nutrition yet.
    seedApi(aMeal());
    renderAt(PAST_URL, <MealsWindow />);

    const total = await dayTotal();
    expect(within(total).getByText("Incomplete")).toBeInTheDocument();
    expect(total).toHaveTextContent("the real total is higher");
  });

  it("links the Incomplete badge to the Foods that still need a label", async () => {
    seedApi(aMeal());
    server.use(signedInAs("member"));
    renderAt(PAST_URL, <App />);

    await userEvent.click(
      within(await dayTotal()).getByRole("link", { name: "Incomplete" }),
    );

    // Profile's Foods page, opened with "No nutrition yet" already on (ADR 0032).
    expect(screen.getByRole("status", { name: "url" })).toHaveTextContent(
      "/profile/foods?missing=1",
    );
    expect(
      await screen.findByRole("button", { name: "No nutrition yet" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("marks a Restaurant Day, with the flat value and no macros", async () => {
    seedApi(aMeal({ id: "a" }), aRestaurantMeal([cafe], { id: "b" }));
    renderAt(PAST_URL, <MealsWindow />);

    const total = await dayTotal();
    expect(within(total).getByText("ate out")).toBeInTheDocument();
    expect(total).toHaveTextContent("Not tracking, has become a cheat day.");
    // No numbers: the flat value would read like a real count.
    expect(total).not.toHaveTextContent(
      RESTAURANT_DAY_KCAL.toLocaleString("en-US"),
    );
    expect(total).not.toHaveTextContent(" cal");
    expect(total).not.toHaveTextContent("Macros");
    expect(total).not.toHaveTextContent("Incomplete");
  });

  it("shows nothing for a Day with no Meals", async () => {
    renderAt(PAST_URL, <MealsWindow />);

    await screen.findByText("No Meals on this Day.");
    expect(
      screen.queryByRole("region", { name: "Day total" }),
    ).not.toBeInTheDocument();
  });

  it("refetches after a Meal is logged", async () => {
    renderAt(PAST_URL, <MealsWindow />);
    await openNewMeal();
    await searchAndAdd("Oats");
    await userEvent.click(
      within(sheet()).getByRole("button", { name: "Save" }),
    );

    // Only the server knows the total: it appears once GET /days answers again.
    expect(await dayTotal()).toHaveTextContent("Incomplete");
  });
});

describe("adding a Meal", () => {
  it("adds Foods from search and chips, and the Meal survives reload", async () => {
    const { unmount } = renderAt(PAST_URL, <MealsWindow />);
    await openNewMeal();

    await searchAndAdd("Oats");
    // Prefilled from last time: 80 g.
    expect(
      within(foodRow("Oats")).getByRole("spinbutton", { name: "Quantity" }),
    ).toHaveValue(80);
    // A chip adds in one tap; Banana was never eaten, so its quantity is blank.
    await userEvent.click(
      within(
        within(sheet()).getByRole("group", { name: "Recent Foods" }),
      ).getByRole("button", { name: "Banana" }),
    );
    const save = within(sheet()).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    await userEvent.type(
      within(foodRow("Banana")).getByRole("spinbutton", { name: "Quantity" }),
      "1",
    );
    await userEvent.selectOptions(
      within(foodRow("Banana")).getByRole("combobox", { name: "Unit" }),
      "count",
    );
    await userEvent.click(save);

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(api.puts).toHaveLength(1);
    expect(api.puts[0]?.body).toMatchObject({
      kind: "foods",
      label: null,
      food_entries: [
        { food_id: oats.id, quantity: 80, unit: "g" },
        { food_id: banana.id, quantity: 1, unit: "count" },
      ],
    });
    expect(api.puts[0]?.body.occurred_at.slice(0, 10)).toBe(PAST_DAY);

    unmount();
    renderAt(PAST_URL, <MealsWindow />);
    expect(await card("Meal")).toHaveTextContent("Banana× 1");
  });

  it("saves a typed Label from Other, and None as no Label", async () => {
    seedRestaurants([tacos]);
    renderAt(PAST_URL, <MealsWindow />);
    await openNewMeal("Add Restaurant");
    await userEvent.click(await recentRestaurant("Taco Stand"));
    const label = within(sheet()).getByRole("combobox", { name: "Label" });
    expect(
      within(label)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["None", "Lunch", "Dinner", "Other..."]);

    expect(
      within(sheet()).queryByRole("textbox", { name: "Other Label" }),
    ).not.toBeInTheDocument();
    await userEvent.selectOptions(label, "Other...");
    const other = within(sheet()).getByRole("textbox", { name: "Other Label" });
    expect(other).toHaveFocus();
    await userEvent.type(other, "Brunch");
    await userEvent.click(
      within(sheet()).getByRole("button", { name: "Save" }),
    );

    await waitFor(() => {
      expect(api.puts).toHaveLength(1);
    });
    expect(api.puts[0]?.body.label).toBe("Brunch");
    expect(await card("Brunch")).toBeInTheDocument();

    await userEvent.click(
      within(await card("Brunch")).getByRole("button", { name: "Edit Brunch" }),
    );
    // A typed Label reopens under Other, without pulling up the keyboard.
    const reopened = within(sheet()).getByRole("textbox", {
      name: "Other Label",
    });
    expect(reopened).toHaveValue("Brunch");
    expect(reopened).not.toHaveFocus();
    await userEvent.selectOptions(
      within(sheet()).getByRole("combobox", { name: "Label" }),
      "None",
    );
    await userEvent.click(
      within(sheet()).getByRole("button", { name: "Save" }),
    );

    await waitFor(() => {
      expect(api.puts).toHaveLength(2);
    });
    expect(api.puts[1]?.body.label).toBeNull();
  });

  it("opens a sheet of the button's kind, titled with the Day and no kind switch", async () => {
    renderAt(PAST_URL, <MealsWindow />);

    await openNewMeal("Add Food");
    expect(
      screen.getByRole("dialog", { name: "Add Food to Mon Nov 2" }),
    ).toBeInTheDocument();
    expect(within(sheet()).queryByRole("radio")).not.toBeInTheDocument();
    await userEvent.click(
      within(sheet()).getByRole("button", { name: "Close" }),
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Add Restaurant" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Add Restaurant to Mon Nov 2" }),
    ).toBeInTheDocument();
    expect(
      within(sheet()).getByRole("combobox", { name: "Add Restaurant" }),
    ).toBeInTheDocument();
    expect(
      within(sheet()).queryByRole("combobox", { name: "Add Food" }),
    ).not.toBeInTheDocument();
  });

  it("adds three Restaurants, removes one, and saves the other two in order", async () => {
    seedRestaurants([cafe, tacos, noodles]);
    renderAt(PAST_URL, <MealsWindow />);
    await openNewMeal("Add Restaurant");
    const save = () => within(sheet()).getByRole("button", { name: "Save" });
    expect(save()).toBeDisabled();

    await userEvent.click(await recentRestaurant("Taco Stand"));
    await userEvent.click(await recentRestaurant("Corner Cafe"));
    await userEvent.type(
      within(sheet()).getByRole("combobox", { name: "Add Restaurant" }),
      "Noodle",
    );
    await userEvent.click(
      await screen.findByRole("option", { name: "Noodle Bar" }),
    );
    await userEvent.click(
      await within(sheet()).findByRole("button", { name: "Add" }),
    );
    expect(restaurantNames()).toEqual([
      "Taco Stand",
      "Corner Cafe",
      "Noodle Bar",
    ]);
    // A Restaurant appears once per Meal (ADR 0034).
    expect(await recentRestaurant("Taco Stand")).toBeDisabled();

    await userEvent.click(
      within(sheet()).getByRole("button", { name: "Remove Corner Cafe" }),
    );
    await userEvent.click(save());

    expect(await card("Meal")).toHaveTextContent("Taco Stand · Noodle Bar");
    expect(api.puts[0]?.body).toEqual(
      expect.objectContaining({
        kind: "restaurant",
        restaurant_ids: [tacos.id, noodles.id],
      }),
    );
    expect(api.puts[0]?.body).not.toHaveProperty("restaurant_id");
  });

  it("closes the sheet from the X without saving", async () => {
    renderAt(PAST_URL, <MealsWindow />);
    await openNewMeal();

    await userEvent.click(
      within(sheet()).getByRole("button", { name: "Close" }),
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.puts).toHaveLength(0);
  });

  it("has no Label on a Food Meal, puts it below the pick on a Restaurant Meal, and no Time on either", async () => {
    renderAt(PAST_URL, <MealsWindow />);
    await openNewMeal();

    expect(
      within(sheet()).queryByRole("combobox", { name: "Label" }),
    ).not.toBeInTheDocument();
    expect(within(sheet()).queryByLabelText("Time")).not.toBeInTheDocument();

    await userEvent.click(
      within(sheet()).getByRole("button", { name: "Close" }),
    );
    await openNewMeal("Add Restaurant");
    const follows = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      follows(
        within(sheet()).getByRole("combobox", { name: "Add Restaurant" }),
        within(sheet()).getByRole("combobox", { name: "Label" }),
      ),
    ).toBe(true);
    expect(within(sheet()).queryByLabelText("Time")).not.toBeInTheDocument();
  });

  it("stays open and takes the Meal back off the feed when the server refuses the save", async () => {
    server.use(
      http.put("*/api/v1/meals/:id", () =>
        HttpResponse.json(
          { title: "Unprocessable Content", status: 422 },
          { status: 422 },
        ),
      ),
    );
    renderAt(PAST_URL, <MealsWindow />);
    await openNewMeal();
    await searchAndAdd("Oats");

    await userEvent.click(
      within(sheet()).getByRole("button", { name: "Save" }),
    );

    expect(
      await within(sheet()).findByText("Unprocessable Content"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });
});

describe("editing a Meal", () => {
  it("resends the whole Meal under the same id", async () => {
    const saved = aMeal({
      food_entries: [
        { food: oats, quantity: 80, unit: "g" },
        { food: banana, quantity: 1, unit: "count" },
      ],
    });
    seedApi(saved);
    renderAt(PAST_URL, <MealsWindow />);

    await userEvent.click(
      within(await card("Meal")).getByRole("button", { name: "Edit Meal" }),
    );
    // A saved Meal's kind cannot change (ADR 0006), so there is no switch to offer.
    expect(within(sheet()).queryByRole("radio")).not.toBeInTheDocument();
    const quantity = within(foodRow("Oats")).getByRole("spinbutton", {
      name: "Quantity",
    });
    await userEvent.clear(quantity);
    await userEvent.type(quantity, "60");
    await userEvent.click(
      within(sheet()).getByRole("button", { name: "Save" }),
    );

    await waitFor(() => {
      expect(api.puts).toHaveLength(1);
    });
    expect(api.puts[0]?.id).toBe(saved.id);
    expect(api.puts[0]?.body).toMatchObject({
      occurred_at: saved.occurred_at,
      food_entries: [
        { food_id: oats.id, quantity: 60 },
        { food_id: banana.id, quantity: 1, unit: "count" },
      ],
    });
  });

  it("keeps a Food Meal's saved Label, though the sheet no longer shows it", async () => {
    seedApi(aMeal({ label: "Brunch" }));
    renderAt(PAST_URL, <MealsWindow />);

    await userEvent.click(
      within(await card("Brunch")).getByRole("button", { name: "Edit Brunch" }),
    );
    expect(
      within(sheet()).queryByRole("combobox", { name: "Label" }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      within(sheet()).getByRole("button", { name: "Save" }),
    );

    await waitFor(() => {
      expect(api.puts).toHaveLength(1);
    });
    expect(api.puts[0]?.body.label).toBe("Brunch");
  });

  it("blocks removing the last Food, and says why", async () => {
    seedApi(
      aMeal({
        food_entries: [
          { food: oats, quantity: 80, unit: "g" },
          { food: banana, quantity: 1, unit: "count" },
        ],
      }),
    );
    renderAt(PAST_URL, <MealsWindow />);
    await userEvent.click(
      within(await card("Meal")).getByRole("button", { name: "Edit Meal" }),
    );

    await userEvent.click(
      within(sheet()).getByRole("button", { name: "Remove Banana" }),
    );

    expect(
      within(sheet()).getByRole("button", { name: "Remove Oats" }),
    ).toBeDisabled();
    expect(
      within(sheet()).getByText(
        "A Meal keeps at least one Food. To remove it, delete the Meal.",
      ),
    ).toBeInTheDocument();
  });

  it("shows a multi-Restaurant Meal's list in order and saves the edit under the same id", async () => {
    const saved = aRestaurantMeal([cafe, tacos, noodles], { id: "r" });
    seedRestaurants([cafe, tacos, noodles], saved);
    renderAt(PAST_URL, <MealsWindow />);

    await userEvent.click(
      within(await card("Meal")).getByRole("button", { name: "Edit Meal" }),
    );
    expect(restaurantNames()).toEqual([
      "Corner Cafe",
      "Taco Stand",
      "Noodle Bar",
    ]);
    await userEvent.click(
      within(sheet()).getByRole("button", { name: "Remove Taco Stand" }),
    );
    await userEvent.click(
      within(sheet()).getByRole("button", { name: "Save" }),
    );

    await waitFor(() => {
      expect(api.puts).toHaveLength(1);
    });
    expect(api.puts[0]?.id).toBe(saved.id);
    expect(api.puts[0]?.body).toMatchObject({
      restaurant_ids: [cafe.id, noodles.id],
    });
  });

  it("stops adding Restaurants at 10, and says why", async () => {
    const ten = Array.from({ length: 10 }, (_, index) =>
      aRestaurant(10 + index, `Stall ${String(index + 1)}`),
    );
    const eleventh = aRestaurant(20, "Stall 11");
    // First in the Catalog, so it is one of the recent chips.
    seedRestaurants(
      [eleventh, ...ten],
      aRestaurantMeal([ten[0] ?? cafe, ...ten.slice(1)]),
    );
    renderAt(PAST_URL, <MealsWindow />);
    await userEvent.click(
      within(await card("Meal")).getByRole("button", { name: "Edit Meal" }),
    );

    expect(restaurantNames()).toHaveLength(10);
    expect(await recentRestaurant("Stall 11")).toBeDisabled();
    expect(
      within(sheet()).getByText(
        "A Meal holds at most 10 Restaurants. Remove one to add another.",
      ),
    ).toBeInTheDocument();

    await userEvent.click(
      within(sheet()).getByRole("button", { name: "Remove Stall 3" }),
    );
    await userEvent.click(await recentRestaurant("Stall 11"));
    expect(restaurantNames().at(-1)).toBe("Stall 11");
    expect(restaurantNames()).toHaveLength(10);
  });

  it("deletes the Meal after a confirm", async () => {
    seedApi(aMeal());
    renderAt(PAST_URL, <MealsWindow />);
    await userEvent.click(
      within(await card("Meal")).getByRole("button", { name: "Edit Meal" }),
    );

    await userEvent.click(
      within(sheet()).getByRole("button", { name: "Delete Meal" }),
    );
    expect(api.meals.size).toBe(1);
    await userEvent.click(
      within(sheet()).getByRole("button", { name: "Delete Meal" }),
    );

    expect(
      await screen.findByText("No Meals on this Day."),
    ).toBeInTheDocument();
    expect(api.meals.size).toBe(0);
  });
});
