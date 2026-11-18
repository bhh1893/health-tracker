import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FILTER_DEBOUNCE_MS, MealFilter } from "./MealFilter";

// Fake timers move the clock by hand, so the pause is checked exactly, whatever
// the machine's speed. fireEvent, not userEvent: it acts at once and never waits
// on a timer of its own.
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const field = () => screen.getByRole("searchbox", { name: "Filter Days" });
const type = (text: string) => {
  fireEvent.change(field(), { target: { value: text } });
};
const wait = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

describe("MealFilter", () => {
  it("commits once typing pauses, trimmed, not once per letter", () => {
    const onCommit = vi.fn();
    render(<MealFilter value="" onCommit={onCommit} />);

    type("c");
    wait(FILTER_DEBOUNCE_MS - 50);
    type("ch");
    wait(FILTER_DEBOUNCE_MS - 50);
    type("chicken ");
    wait(FILTER_DEBOUNCE_MS - 1);
    expect(onCommit).not.toHaveBeenCalled();

    wait(1);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith("chicken");
  });

  it("does not commit the filter it opened with, or a change that is only spaces", () => {
    const onCommit = vi.fn();
    render(<MealFilter value="chicken" onCommit={onCommit} />);
    expect(field()).toHaveValue("chicken");

    type("chicken  ");
    wait(FILTER_DEBOUNCE_MS);

    expect(onCommit).not.toHaveBeenCalled();
  });

  it("clears at once, and the pending text never comes back", () => {
    const onCommit = vi.fn();
    const { rerender } = render(
      <MealFilter value="chicken" onCommit={onCommit} />,
    );

    type("chickenx");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onCommit).toHaveBeenCalledExactlyOnceWith("");
    // The URL now holds no filter.
    rerender(<MealFilter value="" onCommit={onCommit} />);

    wait(FILTER_DEBOUNCE_MS * 2);
    expect(field()).toHaveValue("");
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("has no Clear button while empty", () => {
    render(<MealFilter value="" onCommit={vi.fn()} />);
    expect(
      screen.queryByRole("button", { name: "Clear" }),
    ).not.toBeInTheDocument();
  });
});
