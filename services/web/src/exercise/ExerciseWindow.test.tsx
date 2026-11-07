import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { addDays, formatDay, toDay } from "../lib/day";
import { aSet, bench, fakeExerciseApi } from "../test-handlers";
import { server } from "../test-server";
import { ExerciseWindow } from "./ExerciseWindow";
import type { ExerciseEntry } from "./sessions";
import { renderAt } from "../test-render";

const PAST_DAY = "2026-11-02";
const PAST_URL = `/exercise?day=${PAST_DAY}`;

const repeatButton = (name = "+ 135 lb × 5") =>
  screen.findByRole("button", { name });
const setRows = (exercise = "Bench Press") =>
  within(screen.getByRole("article", { name: exercise })).getAllByRole(
    "listitem",
  );

const refused = () =>
  HttpResponse.json(
    { title: "Unprocessable Content", status: 422 },
    { status: 422 },
  );

let api: ReturnType<typeof fakeExerciseApi>;

function seedApi(...seed: ExerciseEntry[]) {
  api = fakeExerciseApi(seed);
  server.use(...api.handlers);
}

beforeEach(() => {
  seedApi();
});

describe("the Day feed", () => {
  it("shows the viewed Day's Sets, grouped and numbered", async () => {
    seedApi(
      aSet({ id: "b", reps: 3, occurred_at: "2026-11-02T18:10:00+13:00" }),
      aSet({ id: "a", occurred_at: "2026-11-02T18:00:00+13:00" }),
    );
    renderAt(PAST_URL, <ExerciseWindow />);

    await repeatButton("+ 135 lb × 3");
    const [first, second] = setRows();
    expect(first).toHaveTextContent("Set 1 135 lb × 5");
    expect(first).toHaveTextContent("18:00");
    expect(second).toHaveTextContent("Set 2 135 lb × 3");
  });

  it("says so when the Day is empty", async () => {
    renderAt(PAST_URL, <ExerciseWindow />);

    expect(await screen.findByText("No Sets on this Day.")).toBeInTheDocument();
  });

  it("follows the cursor to the end of a long Day", async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.get("*/api/v1/exercise-entries", ({ request }) => {
        const cursor = new URL(request.url).searchParams.get("cursor");
        seen.push(cursor);
        return HttpResponse.json(
          cursor === null
            ? { items: [aSet({ id: "b" })], next_cursor: "page-2" }
            : { items: [aSet({ id: "a" })], next_cursor: null },
        );
      }),
    );
    renderAt(PAST_URL, <ExerciseWindow />);

    await repeatButton();
    expect(setRows()).toHaveLength(2);
    expect(seen).toEqual([null, "page-2"]);
  });

  it("changes feed with the Day", async () => {
    const today = toDay(new Date());
    seedApi(aSet({ day: addDays(today, -1) }));
    renderAt("/exercise", <ExerciseWindow />);

    await screen.findByText("No Sets on this Day.");
    await userEvent.click(screen.getByRole("button", { name: "Previous Day" }));

    expect(await repeatButton()).toBeInTheDocument();
  });
});

describe("one-tap repeat", () => {
  it("shows the Set before the server answers", async () => {
    seedApi(aSet());
    server.use(
      http.put("*/api/v1/exercise-entries/:id", async () => {
        await delay("infinite");
        return new HttpResponse(null);
      }),
    );
    renderAt(PAST_URL, <ExerciseWindow />);

    await userEvent.click(await repeatButton());

    await waitFor(() => {
      expect(setRows()).toHaveLength(2);
    });
  });

  it("saves a new id, copying weight and reps, on the viewed Day", async () => {
    // Later than any clock time, so the repeat must be placed after it.
    const lateSet = aSet({ occurred_at: "2026-11-02T23:59:58+13:00" });
    seedApi(lateSet);
    renderAt(PAST_URL, <ExerciseWindow />);

    await userEvent.click(await repeatButton());

    await waitFor(() => {
      expect(api.entries.size).toBe(2);
    });
    const put = api.puts[0];
    expect(put?.id).not.toBe(aSet().id);
    expect(put?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(put?.body).toMatchObject({
      exercise_id: bench.id,
      reps: 5,
      weight_lb: 135,
    });
    expect(put?.body.occurred_at.slice(0, 10)).toBe(PAST_DAY);
    expect(put?.body.occurred_at).toBe("2026-11-02T23:59:59+13:00");
  });

  it("rolls back and explains when the server refuses", async () => {
    seedApi(aSet());
    server.use(http.put("*/api/v1/exercise-entries/:id", refused));
    renderAt(PAST_URL, <ExerciseWindow />);
    const repeat = await repeatButton();

    // The refetch after the failure never answers, so only the rollback can
    // remove the Set.
    server.use(
      http.get("*/api/v1/exercise-entries", async () => {
        await delay("infinite");
        return new HttpResponse(null);
      }),
    );
    await userEvent.click(repeat);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unprocessable Content",
    );
    expect(setRows()).toHaveLength(1);
  });

  it("keeps a good Set when the write beside it fails", async () => {
    seedApi(aSet());
    const { handlers } = api;
    let calls = 0;
    server.use(
      http.put("*/api/v1/exercise-entries/:id", async (info) => {
        calls += 1;
        if (calls === 1) {
          return refused();
        }
        const put = handlers[1];
        return (await put?.run(info))?.response;
      }),
    );
    renderAt(PAST_URL, <ExerciseWindow />);

    const repeat = await repeatButton();
    await userEvent.click(repeat);
    await userEvent.click(repeat);

    await waitFor(() => {
      expect(api.entries.size).toBe(2);
    });
    await waitFor(() => {
      expect(setRows()).toHaveLength(2);
    });
  });

  it("sends writes in order, so a delete cannot beat its own PUT", async () => {
    seedApi(aSet());
    const order: string[] = [];
    let releasePut: (value: unknown) => void = () => undefined;
    const putReleased = new Promise((resolve) => {
      releasePut = resolve;
    });
    server.use(
      http.put("*/api/v1/exercise-entries/:id", async () => {
        order.push("put started");
        await putReleased;
        order.push("put finished");
        return HttpResponse.json(aSet());
      }),
      http.delete("*/api/v1/exercise-entries/:id", () => {
        order.push("delete");
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderAt(PAST_URL, <ExerciseWindow />);

    await userEvent.click(await repeatButton());
    await userEvent.click(
      screen.getByRole("button", { name: "Delete Bench Press for the Day" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(order).toEqual(["put started"]);

    releasePut(null);

    await waitFor(() => {
      expect(order.at(-1)).toBe("delete");
    });
    expect(order.slice(0, 2)).toEqual(["put started", "put finished"]);
  });
});

describe("the Set sheet", () => {
  const field = (name: string) => screen.getByLabelText(name);
  const save = () => screen.getByRole("button", { name: "Save" });

  async function pickBench() {
    await userEvent.click(screen.getByRole("combobox", { name: "Exercise" }));
    await userEvent.click(
      await screen.findByRole("option", { name: "Bench Press" }),
    );
  }

  it("creates an Exercise from inside the sheet and saves a Set to it", async () => {
    const catalog = [bench];
    api = fakeExerciseApi([], catalog);
    server.use(
      http.put("*/api/v1/exercises/:id", async ({ request, params }) => {
        const { name } = (await request.json()) as { name: string };
        const created = { id: String(params.id), name, archived: false };
        catalog.push(created);
        return HttpResponse.json(created, { status: 201 });
      }),
      ...api.handlers,
    );
    renderAt(PAST_URL, <ExerciseWindow />);

    await userEvent.click(
      await screen.findByRole("button", { name: /Add Set/ }),
    );
    await userEvent.type(
      screen.getByRole("combobox", { name: "Exercise" }),
      "Deadlift",
    );
    await userEvent.click(
      await screen.findByRole("option", { name: '+ Create "Deadlift"' }),
    );
    await waitFor(() => {
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });
    await userEvent.type(field("Reps"), "5");
    await userEvent.click(save());

    expect(
      await screen.findByRole("article", { name: "Deadlift" }),
    ).toBeInTheDocument();
  });

  it("shows a near-duplicate dialog above the sheet, then returns to it", async () => {
    server.use(
      http.put("*/api/v1/exercises/:id", () =>
        HttpResponse.json(
          {
            title: "Conflict",
            status: 409,
            type: "urn:health-tracker:problem:near-duplicate",
            similar: [bench],
          },
          { status: 409 },
        ),
      ),
    );
    renderAt(PAST_URL, <ExerciseWindow />);

    await userEvent.click(
      await screen.findByRole("button", { name: /Add Set/ }),
    );
    await userEvent.type(
      screen.getByRole("combobox", { name: "Exercise" }),
      "Bnch",
    );
    await userEvent.click(
      await screen.findByRole("option", { name: '+ Create "Bnch"' }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Use Bench Press" }),
    );
    await userEvent.type(field("Reps"), "5");
    await userEvent.click(save());

    expect(await repeatButton("+ BW × 5")).toBeInTheDocument();
    expect(api.puts[0]?.body.exercise_id).toBe(bench.id);
  });

  it("names the viewed Day on the add button", async () => {
    renderAt(PAST_URL, <ExerciseWindow />);

    expect(
      await screen.findByRole("button", {
        name: `Add Set to ${formatDay(PAST_DAY)}`,
      }),
    ).toBeInTheDocument();
  });

  it("saves to the viewed Day at the chosen time, and survives a reload", async () => {
    const { client, unmount } = renderAt(PAST_URL, <ExerciseWindow />);

    await userEvent.click(
      await screen.findByRole("button", { name: /Add Set/ }),
    );
    await pickBench();
    await userEvent.clear(field("Time"));
    await userEvent.type(field("Time"), "07:30");
    await userEvent.type(field("Weight (lb)"), "140");
    await userEvent.type(field("Reps"), "8");
    await userEvent.click(save());

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(api.puts[0]?.body).toMatchObject({
      exercise_id: bench.id,
      reps: 8,
      weight_lb: 140,
      occurred_at: "2026-11-02T07:30:00+13:00",
      occurred_tz: "Pacific/Auckland",
    });

    unmount();
    client.clear();
    renderAt(PAST_URL, <ExerciseWindow />);
    expect(await repeatButton("+ 140 lb × 8")).toBeInTheDocument();
  });

  it("treats a blank weight as bodyweight", async () => {
    renderAt(PAST_URL, <ExerciseWindow />);

    await userEvent.click(
      await screen.findByRole("button", { name: /Add Set/ }),
    );
    await pickBench();
    await userEvent.type(field("Reps"), "12");
    await userEvent.click(save());

    expect(await repeatButton("+ BW × 12")).toBeInTheDocument();
    await waitFor(() => {
      expect(api.puts[0]?.body.weight_lb).toBeNull();
    });
  });

  it("will not save without an Exercise and reps", async () => {
    renderAt(PAST_URL, <ExerciseWindow />);

    await userEvent.click(
      await screen.findByRole("button", { name: /Add Set/ }),
    );
    expect(save()).toBeDisabled();

    await pickBench();
    expect(save()).toBeDisabled();

    await userEvent.type(field("Reps"), "1.5");
    expect(save()).toBeDisabled();
  });

  it("prefills from the previous Set", async () => {
    seedApi(aSet({ weight_lb: 142.5, reps: 7 }));
    renderAt(PAST_URL, <ExerciseWindow />);

    await userEvent.click(
      await screen.findByRole("button", { name: "+ Set 2" }),
    );

    expect(screen.getByRole("combobox", { name: "Exercise" })).toHaveValue(
      "Bench Press",
    );
    expect(field("Weight (lb)")).toHaveValue(142.5);
    expect(field("Reps")).toHaveValue(7);
  });

  it("stays open on failure and retries under the same id", async () => {
    seedApi(aSet());
    const ids: unknown[] = [];
    server.use(
      http.put("*/api/v1/exercise-entries/:id", ({ params }) => {
        ids.push(params.id);
        return ids.length === 1
          ? refused()
          : HttpResponse.json(aSet(), { status: 201 });
      }),
    );
    renderAt(PAST_URL, <ExerciseWindow />);

    await userEvent.click(
      await screen.findByRole("button", { name: "+ Set 2" }),
    );
    await userEvent.click(save());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unprocessable Content",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await userEvent.click(save());

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });
});

describe("deleting a Session", () => {
  const twoSets = () => {
    seedApi(aSet({ id: "a" }), aSet({ id: "b", reps: 3 }));
  };
  const openConfirm = async () => {
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Delete Bench Press for the Day",
      }),
    );
    return screen.getByRole("dialog");
  };

  it("lists the Sets and deletes nothing until confirmed", async () => {
    twoSets();
    renderAt(PAST_URL, <ExerciseWindow />);

    const dialog = await openConfirm();
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(2);

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Cancel" }),
    );

    expect(api.entries.size).toBe(2);
    expect(setRows()).toHaveLength(2);
  });

  it("sends one DELETE per Set", async () => {
    twoSets();
    renderAt(PAST_URL, <ExerciseWindow />);

    const dialog = await openConfirm();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete" }),
    );

    expect(await screen.findByText("No Sets on this Day.")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(api.entries.size).toBe(0);
  });

  it("keeps the unsent Set on a partial failure, and retry finishes it", async () => {
    twoSets();
    let broken = true;
    server.use(
      http.delete("*/api/v1/exercise-entries/:id", ({ params }) => {
        if (params.id === "b" && broken) {
          return refused();
        }
        api.entries.delete(String(params.id));
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderAt(PAST_URL, <ExerciseWindow />);

    const dialog = await openConfirm();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete" }),
    );

    expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(1);
    expect(api.entries.size).toBe(1);

    broken = false;
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete" }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(api.entries.size).toBe(0);
  });
});

describe("editing a Session", () => {
  const threeSets = () => {
    seedApi(
      aSet({ id: "a", occurred_at: "2026-11-02T18:00:00+13:00" }),
      aSet({ id: "b", occurred_at: "2026-11-02T18:05:00+13:00" }),
      aSet({ id: "c", occurred_at: "2026-11-02T18:10:00+13:00" }),
    );
  };
  const openEdit = async () => {
    await userEvent.click(
      await screen.findByRole("button", { name: "Edit Bench Press" }),
    );
    return screen.getByRole("dialog");
  };
  const row = (dialog: HTMLElement, name: string) =>
    within(within(dialog).getByRole("group", { name }));
  const setReps = async (dialog: HTMLElement, name: string, reps: string) => {
    const input = row(dialog, name).getByLabelText("Reps");
    await userEvent.clear(input);
    await userEvent.type(input, reps);
  };
  const removeSet = (dialog: HTMLElement, name: string) =>
    userEvent.click(
      row(dialog, name).getByRole("button", { name: `Delete ${name}` }),
    );
  const save = (dialog: HTMLElement) =>
    userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  const sheetCloses = () =>
    waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

  // Records every write, and refuses the ids in `broken`.
  function watchWrites(broken = new Set<string>()) {
    const sent: string[] = [];
    const [, put, remove] = api.handlers;
    server.use(
      http.put("*/api/v1/exercise-entries/:id", async (info) => {
        const id = String(info.params.id);
        sent.push(`PUT ${id}`);
        return broken.has(id) ? refused() : (await put?.run(info))?.response;
      }),
      http.delete("*/api/v1/exercise-entries/:id", async (info) => {
        const id = String(info.params.id);
        sent.push(`DELETE ${id}`);
        return broken.has(id) ? refused() : (await remove?.run(info))?.response;
      }),
    );
    return sent;
  }

  it("sends nothing when nothing changed", async () => {
    threeSets();
    const sent = watchWrites();
    renderAt(PAST_URL, <ExerciseWindow />);

    await save(await openEdit());

    await sheetCloses();
    expect(sent).toEqual([]);
  });

  it("sends one PUT per changed Set and one DELETE per removed Set", async () => {
    threeSets();
    const sent = watchWrites();
    renderAt(PAST_URL, <ExerciseWindow />);

    const dialog = await openEdit();
    await setReps(dialog, "Set 1", "8");
    await removeSet(dialog, "Set 3");
    await save(dialog);

    await sheetCloses();
    expect(sent).toEqual(["PUT a", "DELETE c"]);
    expect(api.entries.get("a")?.reps).toBe(8);
    expect(api.entries.get("a")?.occurred_at).toBe("2026-11-02T18:00:00+13:00");
  });

  it("removes a mis-tapped Set and the change survives a reload", async () => {
    threeSets();
    const { client, unmount } = renderAt(PAST_URL, <ExerciseWindow />);

    const dialog = await openEdit();
    await removeSet(dialog, "Set 2");
    await save(dialog);
    await sheetCloses();

    unmount();
    client.clear();
    renderAt(PAST_URL, <ExerciseWindow />);
    await repeatButton();
    expect(setRows()).toHaveLength(2);
  });

  it("moves a Set to a new time, and the feed reorders", async () => {
    seedApi(
      aSet({ id: "a", reps: 1, occurred_at: "2026-11-02T18:00:00+13:00" }),
      aSet({ id: "b", reps: 2, occurred_at: "2026-11-02T18:05:00+13:00" }),
    );
    renderAt(PAST_URL, <ExerciseWindow />);

    const dialog = await openEdit();
    const time = row(dialog, "Set 2").getByLabelText("Time");
    await userEvent.clear(time);
    await userEvent.type(time, "07:30");
    await save(dialog);
    await sheetCloses();

    expect(api.entries.get("b")?.occurred_at).toBe("2026-11-02T07:30:00+13:00");
    expect(setRows()[0]).toHaveTextContent("Set 1 135 lb × 2");
  });

  it("undoes a removal row by row, sending nothing for it", async () => {
    threeSets();
    const sent = watchWrites();
    renderAt(PAST_URL, <ExerciseWindow />);

    const dialog = await openEdit();
    await removeSet(dialog, "Set 1");
    await removeSet(dialog, "Set 2");
    await userEvent.click(
      row(dialog, "Set 1").getByRole("button", { name: "Undo Set 1" }),
    );
    await save(dialog);

    await sheetCloses();
    expect(sent).toEqual(["DELETE b"]);
  });

  it("will not save a Set with invalid reps", async () => {
    threeSets();
    renderAt(PAST_URL, <ExerciseWindow />);

    const dialog = await openEdit();
    await setReps(dialog, "Set 1", "1.5");

    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("on partial failure keeps the unsent row, and retry sends only it", async () => {
    threeSets();
    const broken = new Set(["b"]);
    const sent = watchWrites(broken);
    renderAt(PAST_URL, <ExerciseWindow />);

    const dialog = await openEdit();
    await setReps(dialog, "Set 1", "8");
    await setReps(dialog, "Set 2", "9");
    await removeSet(dialog, "Set 3");
    await save(dialog);

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Unprocessable Content",
    );
    expect(sent).toEqual(["PUT a", "PUT b", "DELETE c"]);
    expect(within(dialog).getAllByRole("group")).toHaveLength(2);
    expect(row(dialog, "Set 2").getByText("Not saved")).toBeInTheDocument();
    expect(row(dialog, "Set 2").getByLabelText("Reps")).toHaveValue(9);

    broken.clear();
    sent.length = 0;
    await save(dialog);

    await sheetCloses();
    expect(sent).toEqual(["PUT b"]);
    expect(api.entries.get("b")?.reps).toBe(9);
    expect(api.entries.size).toBe(2);
  });

  it("shows edits at once and rolls back only the write that failed", async () => {
    threeSets();
    watchWrites(new Set(["b"]));
    renderAt(PAST_URL, <ExerciseWindow />);

    const dialog = await openEdit();
    // The refetch after the failure never answers, so only the rollback can
    // restore the Set.
    server.use(
      http.get("*/api/v1/exercise-entries", async () => {
        await delay("infinite");
        return new HttpResponse(null);
      }),
    );
    await setReps(dialog, "Set 1", "8");
    await setReps(dialog, "Set 2", "9");
    await save(dialog);

    await within(dialog).findByRole("alert");
    const [first, second] = within(
      screen.getByRole("article", { name: "Bench Press", hidden: true }),
    ).getAllByRole("listitem", { hidden: true });
    expect(first).toHaveTextContent("135 lb × 8");
    expect(second).toHaveTextContent("135 lb × 5");
  });
});
