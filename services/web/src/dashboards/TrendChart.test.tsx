import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { addDays } from "../lib/day";
import { TrendChart, type TrendPoint } from "./TrendChart";

const ACCENT = "var(--color-chart-restaurant)";
const LINE = "var(--color-chart-food)";
const SURFACE = "var(--color-card)";

const first = "2026-11-01";
const day = (n: number) => addDays(first, n);

// The chart draws at its initial size in jsdom, which never measures it, so these
// tests can read the SVG: the line's path and the dot drawn for each point.
function drawChart(points: TrendPoint[]) {
  const { container } = render(
    <TrendChart
      title="Calories per Day"
      measures="food"
      from={points[0]?.day ?? first}
      to={points.at(-1)?.day ?? first}
      fromZero
      formatValue={String}
      accentLabel="ate out"
      hollowLabel="incomplete"
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

  it("is in the Restaurant color with a card-colored ring, and every other point keeps its style", () => {
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
      [LINE, SURFACE],
      [ACCENT, SURFACE],
      [SURFACE, LINE],
    ]);
  });

  it("keeps its dot on a range too long for ordinary dots", () => {
    const points = Array.from({ length: 60 }, (_, n) => ({
      day: day(n),
      value: 2000,
      accent: n === 30,
    }));
    const { dots } = drawChart(points);

    expect(dots.map((dot) => dot.getAttribute("fill"))).toEqual([ACCENT]);
  });

  it("is named in the legend, which leaves out kinds the chart lacks", () => {
    drawChart([
      { day: day(0), value: 2000 },
      { day: day(1), value: 5000, accent: true },
    ]);

    expect(screen.getByRole("list")).toHaveTextContent(/^ate out$/);
  });
});

describe("the view switch", () => {
  it("shows the chart by default, and the table in its place when picked", async () => {
    const { container } = drawChart([
      { day: day(0), value: 2000 },
      { day: day(1), value: 900, hollow: true },
    ]);
    expect(screen.getByRole("radio", { name: "chart" })).toBeChecked();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "table" }));

    expect(container.querySelector("svg.recharts-surface")).toBeNull();
    // The legend explains marks on the chart, so it leaves with it.
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Calories per Day" });
    expect(within(table).getAllByRole("row")).toHaveLength(3);
  });
});
