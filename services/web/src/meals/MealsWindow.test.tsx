import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import {
  aMeal,
  banana,
  cafe,
  fakeMealApi,
  oats,
  RESTAURANT_DAY_KCAL,
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

beforeEach(() => {
  seedApi();
});

const sheet = () => screen.getByRole("dialog");
const card = (name: string) => screen.findByRole("article", { name });
const foodRow = (name: string) =>
  within(within(sheet()).getByRole("list", { name: "Foods" })).getByRole(
    "listitem",
    { name },
  );

async function openNewMeal() {
  await screen.findByText("No Meals on this Day.");
  await userEvent.click(
    screen.getByRole("button", { name: "Add Meal to Mon Nov 2" }),
  );
}

async function searchAndAdd(name: string) {
  await userEvent.type(
    within(sheet()).getByRole("combobox", { name: "Add Food" }),
    name,
  );
  await userEvent.click(await screen.findByRole("option", { name }));
  await userEvent.click(within(sheet()).getByRole("button", { name: "Add" }));
}

describe("the Day feed", () => {
  it("numbers the Day's Meals in time order, with label and contents", async () => {
    seedApi(
      aMeal({
        id: "b",
        kind: "restaurant",
        restaurant: cafe,
        occurred_at: "2026-11-02T13:00:00+13:00",
      }),
      aMeal({ id: "a", label: "Breakfast" }),
    );
    renderAt(PAST_URL, <MealsWindow />);

    const first = await card("Meal 1, Breakfast");
    expect(first).toHaveTextContent("Oats80 g");
    expect(first).toHaveTextContent("08:00");
    expect(await card("Meal 2")).toHaveTextContent("Corner Cafe");
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

  it("marks a Restaurant Day, with the flat value and no macros", async () => {
    seedApi(
      aMeal({ id: "a" }),
      aMeal({ id: "b", kind: "restaurant", restaurant: cafe }),
    );
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
    await userEvent.type(
      within(sheet()).getByRole("textbox", { name: "Note" }),
      "Breakfast",
    );
    await userEvent.click(save);

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(api.puts).toHaveLength(1);
    expect(api.puts[0]?.body).toMatchObject({
      kind: "foods",
      label: "Breakfast",
      food_entries: [
        { food_id: oats.id, quantity: 80, unit: "g" },
        { food_id: banana.id, quantity: 1, unit: "count" },
      ],
    });
    expect(api.puts[0]?.body.occurred_at.slice(0, 10)).toBe(PAST_DAY);

    unmount();
    renderAt(PAST_URL, <MealsWindow />);
    expect(await card("Meal 1, Breakfast")).toHaveTextContent("Banana× 1");
  });

  it("logs a Restaurant Meal from a recent chip", async () => {
    renderAt(PAST_URL, <MealsWindow />);
    await openNewMeal();

    await userEvent.click(
      within(sheet()).getByRole("radio", { name: "Restaurant" }),
    );
    await userEvent.click(
      within(
        await within(sheet()).findByRole("group", {
          name: "Recent Restaurants",
        }),
      ).getByRole("button", { name: "Corner Cafe" }),
    );
    expect(
      within(sheet()).getByRole("combobox", { name: "Restaurant" }),
    ).toHaveValue("Corner Cafe");
    await userEvent.click(
      within(sheet()).getByRole("button", { name: "Save" }),
    );

    expect(await card("Meal 1")).toHaveTextContent("Corner Cafe");
    expect(api.puts[0]?.body).toMatchObject({
      kind: "restaurant",
      restaurant_id: cafe.id,
    });
  });

  it("puts the pick above Note and Time for both kinds of Meal", async () => {
    renderAt(PAST_URL, <MealsWindow />);
    await openNewMeal();

    const note = () => within(sheet()).getByRole("textbox", { name: "Note" });
    const follows = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

    expect(
      follows(
        within(sheet()).getByRole("combobox", { name: "Add Food" }),
        note(),
      ),
    ).toBe(true);

    await userEvent.click(
      within(sheet()).getByRole("radio", { name: "Restaurant" }),
    );
    expect(
      follows(
        within(sheet()).getByRole("combobox", { name: "Restaurant" }),
        note(),
      ),
    ).toBe(true);
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
      within(await card("Meal 1")).getByRole("button", { name: "Edit Meal 1" }),
    );
    // A saved Meal's kind cannot change (ADR 0006).
    expect(
      within(sheet()).getByRole("radio", { name: "Restaurant" }),
    ).toBeDisabled();
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
      within(await card("Meal 1")).getByRole("button", { name: "Edit Meal 1" }),
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

  it("deletes the Meal after a confirm", async () => {
    seedApi(aMeal());
    renderAt(PAST_URL, <MealsWindow />);
    await userEvent.click(
      within(await card("Meal 1")).getByRole("button", { name: "Edit Meal 1" }),
    );

    await userEvent.click(
      within(sheet()).getByRole("button", { name: "Delete Meal" }),
    );
    expect(api.meals.size).toBe(1);
    await userEvent.click(
      within(sheet()).getByRole("button", { name: "Delete Meal 1" }),
    );

    expect(
      await screen.findByText("No Meals on this Day."),
    ).toBeInTheDocument();
    expect(api.meals.size).toBe(0);
  });
});
