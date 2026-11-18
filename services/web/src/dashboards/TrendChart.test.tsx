import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { addDays } from "../lib/day";
import { TrendChart, type TrendPoint } from "./TrendChart";

const ORANGE = "#eb6834";
const BLUE = "#2a78d6";
const WHITE = "#ffffff";

const first = "2026-11-01";
const day = (n: number) => addDays(first, n);

// The chart draws at its initial size in jsdom, which never measures it, so these
// tests can read the SVG: the line's path and the dot drawn for each point.
function drawChart(points: TrendPoint[]) {
  const { container } = render(
    <TrendChart
      title="Calories per Day"
      from={points[0]?.day ?? first}
      to={points.at(-1)?.day ?? first}
      fromZero
      formatValue={String}
      accentLabel="Restaurant Day"
      hollowLabel="Incomplete Day"
      points={points}
    />,
  );
  const lines = [...container.querySelectorAll("path.recharts-line-curve")];
  const dots = [...container.querySelectorAll(".recharts-line-dots circle")];
  return { container, lines, dots };
}

describe("an accent point", () => {
  it("is drawn on the line, which runs through it without a gap", () => {
    const { lines, dots } = drawChart([
      { day: day(0), value: 2000 },
      { day: day(1), value: 5000, accent: true },
      { day: day(2), value: 1800 },
    ]);

    // One series, one path, one "move to": the pen never lifts.
    expect(lines).toHaveLength(1);
    const path = lines[0]?.getAttribute("d") ?? "";
    expect(path.match(/M/g)).toHaveLength(1);
    const accent = dots[1];
    expect(path).toContain(
      `${accent?.getAttribute("cx") ?? ""},${accent?.getAttribute("cy") ?? ""}`,
    );
  });

  it("is orange with a white ring, and every other point keeps its style", () => {
    const { dots } = drawChart([
      { day: day(0), value: 2000 },
      { day: day(1), value: 5000, accent: true },
      { day: day(2), value: 900, hollow: true },
    ]);

    const style = (dot: Element | undefined) => [
      dot?.getAttribute("fill"),
      dot?.getAttribute("stroke"),
    ];
    expect(dots.map(style)).toEqual([
      [BLUE, WHITE],
      [ORANGE, WHITE],
      [WHITE, BLUE],
    ]);
  });

  it("keeps its dot on a range too long for ordinary dots", () => {
    const points = Array.from({ length: 60 }, (_, n) => ({
      day: day(n),
      value: 2000,
      accent: n === 30,
    }));
    const { dots } = drawChart(points);

    expect(dots.map((dot) => dot.getAttribute("fill"))).toEqual([ORANGE]);
  });

  it("is not named in a legend", () => {
    const { container } = drawChart([
      { day: day(0), value: 2000 },
      { day: day(1), value: 5000, accent: true },
    ]);

    expect(container.querySelector("ul")).toBeNull();
    // The table under the chart is the one place that names it.
    const named = screen.getAllByText("Restaurant Day");
    expect(named.map((element) => element.closest("table"))).not.toContain(
      null,
    );
  });
});
