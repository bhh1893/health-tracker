import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Problem } from "../api/client";
import { bench, fakeExerciseApi } from "../test-handlers";
import { server } from "../test-server";
import { CatalogComboBox } from "./CatalogComboBox";
import { exerciseCatalog, type CatalogItem, type CatalogRef } from "./catalogs";
import { renderAt } from "../test-render";

const row = { id: "0190a000-0000-7000-8000-000000000002", archived: false };
const squat: CatalogRef = { ...row, name: "Squat" };

const onChange = vi.fn<(item: CatalogItem | null) => void>();

function Harness({ initial = null }: { initial?: CatalogItem | null }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <CatalogComboBox
        catalog={exerciseCatalog}
        value={value}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
      />
      <p>Picked: {value?.name ?? "nothing"}</p>
    </>
  );
}

const input = () => screen.getByRole("combobox", { name: "Exercise" });

function conflict(problem: Partial<Problem>) {
  return HttpResponse.json(
    { title: "Conflict", status: 409, ...problem },
    { status: 409 },
  );
}

let api: ReturnType<typeof fakeExerciseApi>;

beforeEach(() => {
  onChange.mockReset();
  api = fakeExerciseApi([], [bench, squat]);
  server.use(...api.handlers);
});

describe("CatalogComboBox", () => {
  it("lists recents on focus, from an empty q", async () => {
    renderAt("/", <Harness />);

    await userEvent.click(input());

    expect(
      await screen.findByRole("option", { name: "Bench Press" }),
    ).toBeInTheDocument();
    expect(api.queries).toEqual([""]);
  });

  it("debounces typing into one search", async () => {
    renderAt("/", <Harness />);
    await userEvent.click(input());
    await screen.findByRole("option", { name: "Squat" });

    await userEvent.type(input(), "ben");

    await waitFor(() => {
      expect(
        screen.queryByRole("option", { name: "Squat" }),
      ).not.toBeInTheDocument();
    });
    expect(api.queries).toEqual(["", "ben"]);
  });

  it("keeps the server's fuzzy matches the text does not contain", async () => {
    server.use(
      http.get("*/api/v1/exercises", () => HttpResponse.json([bench])),
    );
    renderAt("/", <Harness />);

    await userEvent.type(input(), "bnech");

    expect(
      await screen.findByRole("option", { name: "Bench Press" }),
    ).toBeInTheDocument();
  });

  it("ignores a slow answer for older text", async () => {
    server.use(
      http.get("*/api/v1/exercises", async ({ request }) => {
        const q = new URL(request.url).searchParams.get("q");
        if (q === "s") {
          await delay(300);
          return HttpResponse.json([bench]);
        }
        return HttpResponse.json(q === "" ? [] : [squat]);
      }),
    );
    renderAt("/", <Harness />);

    await userEvent.type(input(), "s");
    await new Promise((resolve) => setTimeout(resolve, 200));
    await userEvent.type(input(), "q");
    await screen.findByRole("option", { name: "Squat" });
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(
      screen.queryByRole("option", { name: "Bench Press" }),
    ).not.toBeInTheDocument();
  });

  it("picks a suggestion", async () => {
    renderAt("/", <Harness />);
    await userEvent.click(input());

    await userEvent.click(await screen.findByRole("option", { name: "Squat" }));

    expect(screen.getByText("Picked: Squat")).toBeInTheDocument();
    expect(input()).toHaveValue("Squat");
  });

  it("un-picks when the text is edited", async () => {
    renderAt("/", <Harness initial={squat} />);

    await userEvent.type(input(), "s");

    expect(screen.getByText("Picked: nothing")).toBeInTheDocument();
    expect(input()).toHaveValue("Squats");
  });

  it("replaces one pick with another", async () => {
    renderAt("/", <Harness initial={squat} />);
    await userEvent.click(input());

    await userEvent.click(
      await screen.findByRole("option", { name: "Bench Press" }),
    );

    expect(screen.getByText("Picked: Bench Press")).toBeInTheDocument();
    expect(input()).toHaveValue("Bench Press");
  });

  it("un-picks when the text becomes another listed name", async () => {
    renderAt("/", <Harness initial={squat} />);

    await userEvent.clear(input());
    await userEvent.type(input(), "Bench Press");

    expect(screen.getByText("Picked: nothing")).toBeInTheDocument();
  });

  describe("creating", () => {
    const createRow = (name: string) =>
      screen.findByRole("option", { name: `+ Create "${name}"` });

    it("creates through the trailing row and picks the result", async () => {
      const names: unknown[] = [];
      server.use(
        http.put("*/api/v1/exercises/:id", async ({ request, params }) => {
          const body = (await request.json()) as { name: string };
          names.push(body);
          return HttpResponse.json(
            { id: params.id, name: body.name, archived: false },
            { status: 201 },
          );
        }),
      );
      renderAt("/", <Harness />);

      await userEvent.type(input(), "Deadlift");
      await userEvent.click(await createRow("Deadlift"));

      expect(await screen.findByText("Picked: Deadlift")).toBeInTheDocument();
      expect(names).toEqual([{ name: "Deadlift", allow_similar: false }]);
    });

    it("offers no create row for a name already listed", async () => {
      renderAt("/", <Harness />);

      await userEvent.type(input(), "squat");

      await screen.findByRole("option", { name: "Squat" });
      await waitFor(() => {
        expect(
          screen.queryByRole("option", { name: /Create/ }),
        ).not.toBeInTheDocument();
      });
    });

    it("asks before creating a near-duplicate, and can use the match", async () => {
      server.use(
        http.put("*/api/v1/exercises/:id", () =>
          conflict({
            type: "urn:health-tracker:problem:near-duplicate",
            similar: [bench],
          }),
        ),
      );
      renderAt("/", <Harness />);

      await userEvent.type(input(), "Bench Pres");
      server.use(http.get("*/api/v1/exercises", () => HttpResponse.json([])));
      await userEvent.clear(input());
      await userEvent.type(input(), "Bnch Press");
      await userEvent.click(await createRow("Bnch Press"));

      expect(
        await screen.findByRole("heading", { name: "Did you mean?" }),
      ).toBeInTheDocument();
      await userEvent.click(
        screen.getByRole("button", { name: "Use Bench Press" }),
      );

      expect(
        await screen.findByText("Picked: Bench Press"),
      ).toBeInTheDocument();
    });

    it("creates anyway under the same id, with allow_similar", async () => {
      const calls: { id: unknown; allow_similar: boolean }[] = [];
      server.use(
        http.get("*/api/v1/exercises", () => HttpResponse.json([])),
        http.put("*/api/v1/exercises/:id", async ({ request, params }) => {
          const body = (await request.json()) as {
            name: string;
            allow_similar: boolean;
          };
          calls.push({ id: params.id, allow_similar: body.allow_similar });
          if (!body.allow_similar) {
            return conflict({
              type: "urn:health-tracker:problem:near-duplicate",
              similar: [bench],
            });
          }
          return HttpResponse.json(
            { id: params.id, name: body.name, archived: false },
            { status: 201 },
          );
        }),
      );
      renderAt("/", <Harness />);

      await userEvent.type(input(), "Bench Press 2");
      await userEvent.click(await createRow("Bench Press 2"));
      await userEvent.click(
        await screen.findByRole("button", {
          name: 'Create "Bench Press 2" anyway',
        }),
      );

      expect(
        await screen.findByText("Picked: Bench Press 2"),
      ).toBeInTheDocument();
      expect(calls.map(({ allow_similar }) => allow_similar)).toEqual([
        false,
        true,
      ]);
      expect(calls[0]?.id).toBe(calls[1]?.id);
    });

    it("uses an exact match without asking", async () => {
      server.use(
        http.get("*/api/v1/exercises", () => HttpResponse.json([])),
        http.put("*/api/v1/exercises/:id", () =>
          conflict({
            type: "urn:health-tracker:problem:exact-duplicate",
            existing: bench,
          }),
        ),
      );
      renderAt("/", <Harness />);

      await userEvent.type(input(), "bench press");
      await userEvent.click(await createRow("bench press"));

      expect(
        await screen.findByText("Picked: Bench Press"),
      ).toBeInTheDocument();
    });

    it("offers to unarchive an archived exact match", async () => {
      const archived = { ...bench, archived: true };
      server.use(
        http.get("*/api/v1/exercises", () => HttpResponse.json([])),
        http.put("*/api/v1/exercises/:id", () =>
          conflict({
            type: "urn:health-tracker:problem:exact-duplicate",
            existing: archived,
          }),
        ),
        http.patch("*/api/v1/exercises/:id", () => HttpResponse.json(bench)),
      );
      renderAt("/", <Harness />);

      await userEvent.type(input(), "bench press");
      await userEvent.click(await createRow("bench press"));
      await userEvent.click(
        await screen.findByRole("button", { name: "Unarchive Bench Press" }),
      );

      expect(
        await screen.findByText("Picked: Bench Press"),
      ).toBeInTheDocument();
    });

    it("shows a failed create", async () => {
      server.use(
        http.get("*/api/v1/exercises", () => HttpResponse.json([])),
        http.put("*/api/v1/exercises/:id", async () => {
          // A real round trip: the menu closes while the request is pending.
          await delay(20);
          return HttpResponse.json(
            { title: "Unprocessable Content", status: 422 },
            { status: 422 },
          );
        }),
      );
      renderAt("/", <Harness />);

      await userEvent.type(input(), "Row");
      await userEvent.click(await createRow("Row"));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Unprocessable Content",
      );
      expect(input()).toHaveValue("Row");
    });

    it("clears a failed create once something is picked", async () => {
      server.use(
        http.put("*/api/v1/exercises/:id", async () => {
          await delay(20);
          return HttpResponse.json(
            { title: "Unprocessable Content", status: 422 },
            { status: 422 },
          );
        }),
      );
      renderAt("/", <Harness />);

      await userEvent.type(input(), "Sq");
      await userEvent.click(await createRow("Sq"));
      await screen.findByRole("alert");
      await userEvent.type(input(), "u");
      await userEvent.click(
        await screen.findByRole("option", { name: "Squat" }),
      );

      expect(await screen.findByText("Picked: Squat")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });
});
