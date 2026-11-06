import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it } from "vitest";

import { toDay } from "./day";
import { useViewedDay } from "./useViewedDay";

function renderAt(url: string) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
  );
  return renderHook(
    () => ({ viewed: useViewedDay(), location: useLocation() }),
    { wrapper },
  );
}

describe("useViewedDay", () => {
  it("defaults to today", () => {
    const { result } = renderAt("/meals");
    expect(result.current.viewed.day).toBe(toDay(new Date()));
    expect(result.current.viewed.isToday).toBe(true);
  });

  it("reads the Day from the URL", () => {
    const { result } = renderAt("/meals?day=2026-11-02");
    expect(result.current.viewed.day).toBe("2026-11-02");
    expect(result.current.viewed.isToday).toBe(false);
  });

  it("writes a past Day to the URL, keeping other params", () => {
    const { result } = renderAt("/meals?filter=eggs");
    act(() => {
      result.current.viewed.setDay("2026-11-02");
    });
    expect(result.current.location.search).toBe("?filter=eggs&day=2026-11-02");
  });

  it("removes the param when going back to today", () => {
    const { result } = renderAt("/meals?day=2026-11-02");
    act(() => {
      result.current.viewed.setDay(toDay(new Date()));
    });
    expect(result.current.location.search).toBe("");
  });
});
