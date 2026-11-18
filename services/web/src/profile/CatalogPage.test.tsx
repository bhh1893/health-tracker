import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "../App";
import { LIST_LIMIT } from "../catalog/queries";
import { fakeCatalogApi, signedInAs } from "../test-handlers";
import { renderAt } from "../test-render";
import { server } from "../test-server";

const UUIDV7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const label = {
  basis_g: 100,
  kcal: 165,
  protein_g: 31,
  carbs_g: 0,
  fat_g: 3.6,
};

const chicken = {
  id: "0190a000-0000-7000-8000-000000000401",
  name: "Chicken breast",
  archived: false,
  last_used_day: "2026-11-02",
  nutrition: label,
  piece_g: null,
};
const soup = {
  id: "0190a000-0000-7000-8000-000000000402",
  name: "Chicken soup",
  archived: false,
  last_used_day: "2026-11-01",
  nutrition: null,
  piece_g: null,
};
const thigh = {
  id: "0190a000-0000-7000-8000-000000000403",
  name: "Chicken thigh",
  archived: true,
  last_used_day: "2026-10-01",
  nutrition: null,
  piece_g: null,
};
const rice = {
  id: "0190a000-0000-7000-8000-000000000404",
  name: "Rice",
  archived: false,
  last_used_day: null,
  nutrition: null,
  piece_g: null,
};

const bench = {
  id: "0190a000-0000-7000-8000-000000000501",
  name: "Bench Press",
  archived: false,
  last_used_day: "2026-11-02",
};
const squat = {
  id: "0190a000-0000-7000-8000-000000000502",
  name: "Squat",
  archived: false,
  last_used_day: null,
};

function foods() {
  const api = fakeCatalogApi("foods", [chicken, soup, thigh, rice]);
  server.use(signedInAs("member"), ...api.handlers);
  return api;
}

function exercises(similarTo?: (name: string) => string[]) {
  const api = fakeCatalogApi("exercises", [bench, squat], similarTo);
  server.use(signedInAs("member"), ...api.handlers);
  return api;
}

const url = () => screen.getByRole("status", { name: "url" }).textContent;

async function rows(plural = "Foods") {
  const list = await screen.findByRole("list", { name: plural });
  return within(list)
    .getAllByRole("button")
    .map((row) => within(row).getAllByText(/./)[0]?.textContent);
}

async function openRow(name: string, plural: string) {
  const list = await screen.findByRole("list", { name: plural });
  await userEvent.click(
    within(list).getByRole("button", { name: new RegExp(name) }),
  );
  const sheet = await screen.findByRole("dialog", { name });
  // The form appears once the item has loaded.
  await within(sheet).findByRole("textbox", { name: "Name" });
  return sheet;
}

async function rename(sheet: HTMLElement, name: string) {
  const field = within(sheet).getByRole("textbox", { name: "Name" });
  await userEvent.clear(field);
  await userEvent.type(field, name);
  await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
}

describe("Profile's Catalogs", () => {
  it("links to a page for each Catalog", async () => {
    server.use(signedInAs("member"));
    renderAt("/profile", <App />);

    const nav = await screen.findByRole("navigation", { name: "Catalogs" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/profile/foods",
      "/profile/restaurants",
      "/profile/exercises",
    ]);
  });
});

describe("a Catalog page", () => {
  it("loads the whole Catalog once, in the API's order", async () => {
    const api = foods();
    renderAt("/profile/foods", <App />);

    expect(await rows()).toEqual(["Chicken breast", "Chicken soup", "Rice"]);
    expect(api.lists).toHaveLength(1);
    const asked = api.lists[0];
    // No search on the server: an empty q is the API's "everything, recent first".
    expect(asked?.get("q") ?? "").toBe("");
    expect(asked?.get("limit")).toBe(String(LIST_LIMIT));
    expect(asked?.get("include_archived")).toBe("false");
  });

  it("shows a Food's label, or says it has none yet", async () => {
    foods();
    renderAt("/profile/foods", <App />);
    const list = await screen.findByRole("list", { name: "Foods" });

    const withLabel = within(list).getByRole("button", {
      name: /Chicken breast/,
    });
    expect(withLabel).toHaveTextContent(
      "165 kcal per 100 g · P 31 g · C 0 g · F 3.6 g",
    );
    const without = within(list).getByRole("button", { name: /Rice/ });
    expect(without).toHaveTextContent("No nutrition yet");
  });

  it("combines the filters and keeps them in the URL", async () => {
    foods();
    renderAt("/profile/foods", <App />);
    await rows();

    await userEvent.type(
      screen.getByRole("searchbox", { name: "Search Foods" }),
      "CHICK",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "No nutrition yet" }),
    );

    expect(await rows()).toEqual(["Chicken soup"]);
    expect(url()).toBe("/profile/foods?q=CHICK&missing=1");

    await userEvent.click(
      screen.getByRole("button", { name: "Show archived" }),
    );

    await waitFor(async () => {
      expect(await rows()).toEqual(["Chicken soup", "Chicken thigh"]);
    });
    expect(url()).toBe("/profile/foods?q=CHICK&archived=1&missing=1");
    expect(
      screen.getByRole("button", { name: /Chicken thigh/ }),
    ).toHaveTextContent("Archived");
  });

  it("restores the filters from the URL", async () => {
    const api = foods();
    renderAt("/profile/foods?q=chick&archived=1&missing=1", <App />);

    expect(await rows()).toEqual(["Chicken soup", "Chicken thigh"]);
    expect(screen.getByRole("searchbox", { name: "Search Foods" })).toHaveValue(
      "chick",
    );
    expect(
      screen.getByRole("button", { name: "Show archived" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(api.lists[0]?.get("include_archived")).toBe("true");
  });

  it("comes back filtered after a visit to another tab", async () => {
    foods();
    server.use(...fakeCatalogApi("exercises", []).handlers);
    renderAt("/profile/foods?q=soup", <App />);
    await rows();
    const tabs = screen.getByRole("navigation", { name: "Tabs" });

    await userEvent.click(within(tabs).getByRole("link", { name: "History" }));
    await userEvent.click(within(tabs).getByRole("link", { name: "Profile" }));

    expect(url()).toBe("/profile/foods?q=soup");
    expect(await rows()).toEqual(["Chicken soup"]);
  });

  it("says when a filter matches nothing", async () => {
    foods();
    renderAt("/profile/foods?q=chiken", <App />);

    // A substring match, not the typeahead's fuzzy one (ADR 0032).
    expect(await screen.findByText("No Foods match.")).toBeInTheDocument();
  });

  it("says so when the list may be cut off at the cap", async () => {
    const many = Array.from({ length: LIST_LIMIT }, (_, n) => ({
      ...squat,
      id: `0190a000-0000-7000-8000-${String(n).padStart(12, "0")}`,
      name: `Exercise ${String(n)}`,
    }));
    server.use(
      signedInAs("member"),
      ...fakeCatalogApi("exercises", many).handlers,
    );
    renderAt("/profile/exercises", <App />);

    expect(
      await screen.findByText("Showing the first 1,000 Exercises."),
    ).toBeInTheDocument();
  });
});

describe("a Catalog item sheet", () => {
  it("creates an item from + with one PUT and a client-made id", async () => {
    const api = exercises();
    renderAt("/profile/exercises", <App />);
    await rows("Exercises");

    await userEvent.click(screen.getByRole("button", { name: "New Exercise" }));
    const sheet = await screen.findByRole("dialog", { name: "New Exercise" });
    await userEvent.type(
      within(sheet).getByRole("textbox", { name: "Name" }),
      "Deadlift",
    );
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(api.writes).toHaveLength(1);
    const [put] = api.writes;
    expect(put?.method).toBe("PUT");
    expect(put?.id).toMatch(UUIDV7);
    expect(put?.body).toEqual({ name: "Deadlift", allow_similar: false });
    expect(await rows("Exercises")).toContain("Deadlift");
  });

  it("refuses an empty name before sending anything", async () => {
    const api = exercises();
    renderAt("/profile/exercises", <App />);
    await rows("Exercises");

    await userEvent.click(screen.getByRole("button", { name: "New Exercise" }));
    const sheet = await screen.findByRole("dialog", { name: "New Exercise" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));

    expect(
      within(sheet).getByText("A Exercise needs a name."),
    ).toBeInTheDocument();
    expect(api.writes).toHaveLength(0);
  });

  it("renames, and the list shows the new name", async () => {
    const api = exercises();
    renderAt("/profile/exercises", <App />);

    const sheet = await openRow("Squat", "Exercises");
    await rename(sheet, "Back Squat");

    await waitFor(async () => {
      expect(await rows("Exercises")).toEqual(["Bench Press", "Back Squat"]);
    });
    expect(api.writes).toEqual([
      {
        method: "PATCH",
        id: squat.id,
        body: { name: "Back Squat", allow_similar: false },
      },
    ]);
  });

  it("blocks a rename onto a taken name and opens the item that has it", async () => {
    const api = exercises();
    renderAt("/profile/exercises", <App />);

    const sheet = await openRow("Squat", "Exercises");
    await rename(sheet, "bench press");

    const alert = await within(sheet).findByRole("alert");
    expect(alert).toHaveTextContent('"Bench Press" already exists.');
    expect(
      within(alert).queryByRole("button", { name: /anyway/ }),
    ).not.toBeInTheDocument();

    await userEvent.click(
      within(alert).getByRole("button", { name: "Open Bench Press" }),
    );

    const other = await screen.findByRole("dialog", { name: "Bench Press" });
    expect(
      await within(other).findByRole("textbox", { name: "Name" }),
    ).toHaveValue("Bench Press");
    expect(api.writes.filter(({ method }) => method === "PATCH")).toHaveLength(
      1,
    );
  });

  it("lists similar names on a rename and saves anyway when asked", async () => {
    const api = exercises((name) =>
      name === "Bench Presses" ? ["Bench Press"] : [],
    );
    renderAt("/profile/exercises", <App />);

    const sheet = await openRow("Squat", "Exercises");
    await rename(sheet, "Bench Presses");

    const alert = await within(sheet).findByRole("alert");
    expect(alert).toHaveTextContent("Similar names already exist:");
    expect(
      within(alert).getByRole("button", { name: "Open Bench Press" }),
    ).toBeInTheDocument();

    await userEvent.click(
      within(alert).getByRole("button", {
        name: 'Save "Bench Presses" anyway',
      }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(api.writes.map(({ body }) => body)).toEqual([
      { name: "Bench Presses", allow_similar: false },
      { name: "Bench Presses", allow_similar: true },
    ]);
  });

  it("forgets a clash once the name is edited", async () => {
    exercises((name) => (name === "Bench Presses" ? ["Bench Press"] : []));
    renderAt("/profile/exercises", <App />);

    const sheet = await openRow("Squat", "Exercises");
    await rename(sheet, "Bench Presses");
    await within(sheet).findByRole("alert");

    await userEvent.type(
      within(sheet).getByRole("textbox", { name: "Name" }),
      "!",
    );

    // "Save anyway" would otherwise vouch for a name the server never checked.
    expect(within(sheet).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("offers Delete only for an item no Entry uses", async () => {
    exercises();
    renderAt("/profile/exercises", <App />);

    let sheet = await openRow("Bench Press", "Exercises");
    expect(
      within(sheet).getByRole("button", { name: "Archive" }),
    ).toBeInTheDocument();
    expect(
      within(sheet).queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();

    await userEvent.click(
      within(sheet).getByRole("button", { name: "Cancel" }),
    );
    sheet = await openRow("Squat", "Exercises");
    expect(
      within(sheet).getByRole("button", { name: "Delete" }),
    ).toBeInTheDocument();
  });

  it("deletes a never-used item after asking once more", async () => {
    const api = exercises();
    renderAt("/profile/exercises", <App />);

    const sheet = await openRow("Squat", "Exercises");
    await userEvent.click(
      within(sheet).getByRole("button", { name: "Delete" }),
    );
    expect(api.writes).toHaveLength(0);
    await userEvent.click(
      within(sheet).getByRole("button", { name: "Delete for good" }),
    );

    await waitFor(async () => {
      expect(await rows("Exercises")).toEqual(["Bench Press"]);
    });
    expect(api.writes).toEqual([{ method: "DELETE", id: squat.id }]);
  });

  it("archives an item off the list, and unarchives it from Show archived", async () => {
    const api = exercises();
    renderAt("/profile/exercises", <App />);

    let sheet = await openRow("Bench Press", "Exercises");
    await userEvent.click(
      within(sheet).getByRole("button", { name: "Archive" }),
    );
    await waitFor(async () => {
      expect(await rows("Exercises")).toEqual(["Squat"]);
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Show archived" }),
    );
    sheet = await openRow("Bench Press", "Exercises");
    await userEvent.click(
      within(sheet).getByRole("button", { name: "Unarchive" }),
    );

    await waitFor(() => {
      expect(api.items.get(bench.id)?.archived).toBe(false);
    });
    expect(api.writes.map(({ body }) => body?.archived)).toEqual([true, false]);
  });
});

describe("the Food sheet on Profile", () => {
  it("fills in a Food's Nutrition without the Meals window", async () => {
    const api = foods();
    renderAt("/profile/foods?missing=1", <App />);

    const sheet = await openRow("Rice", "Foods");
    const fill = async (name: string, value: string) => {
      await userEvent.type(
        within(sheet).getByRole("spinbutton", { name }),
        value,
      );
    };
    await fill("Basis (g)", "100");
    await fill("Calories (kcal)", "130");
    await fill("Protein (g)", "2.7");
    await fill("Carbs (g)", "28");
    await fill("Fat (g)", "0.3");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));

    // It no longer lacks Nutrition, so the "No nutrition yet" filter drops it.
    await waitFor(async () => {
      expect(await rows()).toEqual(["Chicken soup"]);
    });
    expect(api.items.get(rice.id)?.nutrition).toEqual({
      basis_g: 100,
      kcal: 130,
      protein_g: 2.7,
      carbs_g: 28,
      fat_g: 0.3,
    });
  });

  it("creates a Food from + with its label in one PUT", async () => {
    const api = foods();
    renderAt("/profile/foods", <App />);
    await rows();

    await userEvent.click(screen.getByRole("button", { name: "New Food" }));
    const sheet = await screen.findByRole("dialog", { name: "New Food" });
    await userEvent.type(
      within(sheet).getByRole("textbox", { name: "Name" }),
      "Oats",
    );
    await userEvent.type(
      within(sheet).getByRole("spinbutton", { name: "Piece Weight (g)" }),
      "40",
    );
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    const [put] = api.writes;
    expect(put?.method).toBe("PUT");
    expect(put?.id).toMatch(UUIDV7);
    expect(put?.body).toEqual({
      name: "Oats",
      nutrition: null,
      piece_g: 40,
      allow_similar: false,
    });
    expect(await rows()).toContain("Oats");
  });

  it("offers Archive and hides Delete for a Food that was eaten", async () => {
    foods();
    renderAt("/profile/foods", <App />);

    const sheet = await openRow("Chicken breast", "Foods");

    expect(
      within(sheet).getByRole("button", { name: "Archive" }),
    ).toBeInTheDocument();
    expect(
      within(sheet).queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();
  });
});
