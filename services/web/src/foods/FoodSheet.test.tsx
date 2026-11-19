import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { App } from "../App";
import { MealsWindow } from "../meals/MealsWindow";
import { aMeal, banana, fakeMealApi, oats, signedInAs } from "../test-handlers";
import { renderAt } from "../test-render";
import { server } from "../test-server";

// Driven from Profile's Foods page, the only place the sheet opens (ADR 0032).
const FOODS_URL = "/profile/foods";
const PAST_URL = "/meals?day=2026-11-02";

let api: ReturnType<typeof fakeMealApi>;

beforeEach(() => {
  api = fakeMealApi([aMeal()], [oats, banana]);
  server.use(signedInAs("member"), ...api.handlers);
});

const mealSheet = () => screen.getByRole("dialog", { name: "Edit Meal 1" });
const foodSheet = (name = "Oats") => screen.findByRole("dialog", { name });
const field = (sheet: HTMLElement, name: string) =>
  within(sheet).getByRole("spinbutton", { name });

async function openOats() {
  const list = await screen.findByRole("list", { name: "Foods" });
  await userEvent.click(within(list).getByRole("button", { name: /^Oats/ }));
  const sheet = await foodSheet();
  // The form appears once the Food has loaded.
  await within(sheet).findByRole("textbox", { name: "Name" });
  return sheet;
}

async function typeInto(sheet: HTMLElement, name: string, value: string) {
  const input = field(sheet, name);
  await userEvent.clear(input);
  await userEvent.type(input, value);
}

const save = (sheet: HTMLElement) =>
  userEvent.click(within(sheet).getByRole("button", { name: "Save" }));

describe("the Food sheet", () => {
  it("fills Nutrition from a Reference Food and saves it in one PATCH", async () => {
    renderAt(FOODS_URL, <App />);
    const sheet = await openOats();

    await userEvent.type(
      within(sheet).getByRole("combobox", { name: "Fill from reference" }),
      "rolled",
    );
    await userEvent.click(
      await screen.findByRole("option", { name: /Rolled oats/ }),
    );

    // Copied into the form, which the user can still check and change. The list
    // has closed: an open one hides the rest of the sheet from a screen reader.
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(field(sheet, "Basis (g)")).toHaveValue(100);
    expect(field(sheet, "Calories (kcal)")).toHaveValue(379);
    expect(field(sheet, "Fat (g)")).toHaveValue(6.5);
    // The name stays the User's own: copy-on-pick never takes it.
    expect(within(sheet).getByRole("textbox", { name: "Name" })).toHaveValue(
      "Oats",
    );
    expect(within(sheet).getByRole("status")).toHaveTextContent(
      "Filled from Rolled oats",
    );

    await save(sheet);

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Oats" }),
      ).not.toBeInTheDocument();
    });
    expect(api.patches).toEqual([
      {
        id: oats.id,
        body: {
          name: "Oats",
          nutrition: {
            basis_g: 100,
            kcal: 379,
            protein_g: 13,
            carbs_g: 68,
            fat_g: 6.5,
          },
          piece_g: null,
          allow_similar: false,
        },
      },
    ]);
  });

  it("takes a label typed by hand, and shows it as typed when reopened", async () => {
    renderAt(FOODS_URL, <App />);
    let sheet = await openOats();

    await typeInto(sheet, "Basis (g)", "40");
    await typeInto(sheet, "Calories (kcal)", "150");
    await typeInto(sheet, "Protein (g)", "5");
    await typeInto(sheet, "Carbs (g)", "27");
    await typeInto(sheet, "Fat (g)", "3");
    await save(sheet);
    await waitFor(() => {
      expect(api.patches).toHaveLength(1);
    });

    sheet = await openOats();
    expect(field(sheet, "Basis (g)")).toHaveValue(40);
    expect(field(sheet, "Calories (kcal)")).toHaveValue(150);
  });

  it("blocks a partial Nutrition block before sending anything", async () => {
    renderAt(FOODS_URL, <App />);
    const sheet = await openOats();

    await typeInto(sheet, "Calories (kcal)", "150");
    await save(sheet);

    expect(
      within(sheet).getByText("Fill in all five, or clear them all."),
    ).toBeInTheDocument();
    expect(api.patches).toHaveLength(0);

    // Clearing the block makes it valid again: a Food without Nutrition.
    await userEvent.click(
      within(sheet).getByRole("button", { name: "Clear Nutrition" }),
    );
    expect(
      within(sheet).queryByText("Fill in all five, or clear them all."),
    ).not.toBeInTheDocument();
  });

  it("marks a macro heavier than the Basis on its own field", async () => {
    renderAt(FOODS_URL, <App />);
    const sheet = await openOats();

    await typeInto(sheet, "Basis (g)", "40");
    await typeInto(sheet, "Calories (kcal)", "150");
    await typeInto(sheet, "Protein (g)", "41");
    await typeInto(sheet, "Carbs (g)", "27");
    await typeInto(sheet, "Fat (g)", "3");
    await save(sheet);

    expect(field(sheet, "Protein (g)")).toHaveAttribute("aria-invalid", "true");
    expect(field(sheet, "Protein (g)")).toHaveAccessibleDescription(
      "No more than the Basis.",
    );
    expect(api.patches).toHaveLength(0);
  });

  // A 4xx, which is not retried (query-client.ts), so the answer shows at once.
  it("stays open with the server's answer when the save fails", async () => {
    server.use(
      http.patch("*/api/v1/foods/:id", () =>
        HttpResponse.json({ title: "Not Found", status: 404 }, { status: 404 }),
      ),
    );
    renderAt(FOODS_URL, <App />);
    const sheet = await openOats();

    await typeInto(sheet, "Piece Weight (g)", "30");
    await save(sheet);

    expect(await within(sheet).findByText("Not Found")).toBeInTheDocument();
    expect(field(sheet, "Piece Weight (g)")).toHaveValue(30);
  });

  it("offers to save a near-duplicate name anyway", async () => {
    let calls = 0;
    server.use(
      http.patch("*/api/v1/foods/:id", async ({ request }) => {
        calls += 1;
        const body = (await request.json()) as { allow_similar: boolean };
        if (!body.allow_similar) {
          return HttpResponse.json(
            {
              type: "urn:health-tracker:problem:near-duplicate",
              title: "Conflict",
              status: 409,
              similar: [banana],
            },
            { status: 409 },
          );
        }
        return HttpResponse.json({ ...oats, name: "Bananas" });
      }),
    );
    renderAt(FOODS_URL, <App />);
    const sheet = await openOats();

    const name = within(sheet).getByRole("textbox", { name: "Name" });
    await userEvent.clear(name);
    await userEvent.type(name, "Bananas");
    await save(sheet);
    await userEvent.click(
      await within(sheet).findByRole("button", {
        name: 'Save "Bananas" anyway',
      }),
    );

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Oats" }),
      ).not.toBeInTheDocument();
    });
    expect(calls).toBe(2);
  });
});

describe("Foods in the Meal sheet", () => {
  it("has no route to the Food sheet: a Food Entry's name is plain text", async () => {
    renderAt(PAST_URL, <MealsWindow />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Edit Meal 1" }),
    );

    const row = within(mealSheet()).getByRole("listitem", { name: "Oats" });
    // Remove is the row's only button; the name opens nothing.
    expect(
      within(row)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Remove Oats"]);
    await userEvent.click(within(row).getByText("Oats"));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("creates a new Food in one tap and opens no Food sheet", async () => {
    renderAt(PAST_URL, <MealsWindow />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Edit Meal 1" }),
    );

    await userEvent.type(
      within(mealSheet()).getByRole("combobox", { name: "Add Food" }),
      "Banana",
    );
    await userEvent.click(
      await screen.findByRole("option", { name: "Banana" }),
    );
    // findBy: Add is hidden from assistive tech until the suggestions close.
    await userEvent.click(
      await within(mealSheet()).findByRole("button", { name: "Add" }),
    );

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });
});
