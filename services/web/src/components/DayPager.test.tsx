import { act, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderAt } from "../test-render";
import { addDays, formatDay, toDay } from "../lib/day";
import { DayPager } from "./DayPager";

const url = () => screen.getByLabelText("url");
const today = () => toDay(new Date());

describe("DayPager", () => {
  it("steps back into the URL and forward out of it", async () => {
    const yesterday = addDays(today(), -1);
    renderAt("/exercise", <DayPager />);

    await userEvent.click(screen.getByRole("button", { name: "Previous Day" }));
    expect(url()).toHaveTextContent(`/exercise?day=${yesterday}`);

    await userEvent.click(screen.getByRole("button", { name: "Next Day" }));
    expect(url().textContent).toBe("/exercise");
  });

  it("cannot go past Today", () => {
    renderAt("/exercise", <DayPager />);

    expect(screen.getByRole("button", { name: "Next Day" })).toBeDisabled();
    expect(screen.getByLabelText("Choose Day")).toHaveAttribute("max", today());
    expect(screen.queryByText(/Viewing a past Day/)).not.toBeInTheDocument();
  });

  it("treats a future Day in the URL as Today", () => {
    renderAt("/exercise?day=2999-01-01", <DayPager />);

    expect(
      screen.getByText(`Today, ${formatDay(today())}`),
    ).toBeInTheDocument();
  });

  it("jumps to a picked Day and keeps other params", () => {
    renderAt("/exercise?keep=1", <DayPager />);

    fireEvent.change(screen.getByLabelText("Choose Day"), {
      target: { value: "2026-11-02" },
    });

    expect(url()).toHaveTextContent("/exercise?keep=1&day=2026-11-02");
  });

  it("ignores a cleared picker", () => {
    renderAt("/exercise?day=2026-11-02", <DayPager />);

    fireEvent.change(screen.getByLabelText("Choose Day"), {
      target: { value: "" },
    });

    expect(url()).toHaveTextContent("/exercise?day=2026-11-02");
  });

  it("offers the way back from a past Day", async () => {
    renderAt("/exercise?day=2026-11-02", <DayPager />);

    await userEvent.click(
      screen.getByRole("button", { name: /Viewing a past Day/ }),
    );

    expect(url().textContent).toBe("/exercise");
  });

  it("moves to the new date when the app resumes after midnight", () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 7, 23, 59), toFake: ["Date"] });
    try {
      renderAt("/exercise", <DayPager />);
      expect(screen.getByText("Today, Sat Nov 7")).toBeInTheDocument();

      vi.setSystemTime(new Date(2026, 10, 8, 7, 0));
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });

      expect(screen.getByText("Today, Sun Nov 8")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
