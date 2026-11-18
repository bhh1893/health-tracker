import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDebouncedValue } from "./useDebouncedValue";

afterEach(() => {
  vi.useRealTimers();
});

describe("useDebouncedValue", () => {
  // Fake timers make "quick" exact: a component test that types fast can only
  // hope the machine keeps up, and a busy one does not.
  it("settles on the last value once it stops changing, skipping the ones between", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 150),
      { initialProps: { value: "" } },
    );

    for (const value of ["b", "be", "ben"]) {
      rerender({ value });
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(result.current).toBe("");
    }

    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(result.current).toBe("ben");
  });
});
