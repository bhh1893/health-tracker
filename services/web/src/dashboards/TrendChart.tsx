import { useState } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Segments } from "../components/Segments";
import { formatDay } from "../lib/day";
import { niceTicks } from "./scale";

// Chart colors are the theme's tokens (index.css), read as CSS variables because
// Recharts paints SVG attributes, which take no Tailwind class. The line takes the
// color of what it measures (ADR 0035).
const LINES = {
  food: "var(--color-chart-food)",
  exercise: "var(--color-chart-exercise)",
};
const ACCENT = "var(--color-chart-restaurant)";
const SURFACE = "var(--color-card)";
const GRID = "var(--color-edge)";
const AXIS_TEXT = "var(--color-faint)";

// Above this many points a dot on each one is clutter, and the line alone reads better.
const MAX_DOTTED_POINTS = 45;
const X_TICKS = 4;
const MS_PER_DAY = 86_400_000;

// One Day on the chart, drawn on the line at `value`.
export interface TrendPoint {
  day: string;
  value: number | null;
  // Drawn in pink: a Day of another kind on the same line, such as a Restaurant
  // Day. Its kind is a property of the point, not a second series (ADR 0033).
  accent?: boolean;
  // Drawn as a ring instead of a filled dot: the value under-reports.
  hollow?: boolean;
  // Extra lines for the tooltip and the table, such as the Sets or the macros.
  detail?: string | undefined;
}

interface TrendChartProps {
  title: string;
  // What the line measures, which picks its color.
  measures: keyof typeof LINES;
  points: TrendPoint[];
  // The Days the x axis spans, both included, so a quiet week shows as a gap.
  from: string;
  to: string;
  formatValue: (value: number) => string;
  // Calories are an amount, read against zero. A top Set or a Session's volume is
  // read by its change, which a zero baseline would flatten into a straight line.
  fromZero: boolean;
  // Name an accent point and a ring in the legend, the tooltip and the table. The
  // legend names each only when the chart has such points.
  accentLabel?: string;
  hollowLabel?: string;
}

// A Day as a whole number of days, so the axis is spaced by the calendar and a
// daylight saving change cannot make one Day wider than another.
function dayNumber(day: string) {
  const [year, month, dayOfMonth] = day.split("-").map(Number);
  return (
    Date.UTC(Number(year), Number(month) - 1, Number(dayOfMonth)) / MS_PER_DAY
  );
}

const MONTH_DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const MONTH_YEAR = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "2-digit",
  timeZone: "UTC",
});

function xTicks(start: number, end: number) {
  if (end <= start) {
    return [start];
  }
  const step = (end - start) / (X_TICKS - 1);
  return Array.from({ length: X_TICKS }, (_, index) =>
    Math.round(start + index * step),
  );
}

const COMPACT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const VIEWS = [
  { id: "chart", label: "chart" },
  { id: "table", label: "table" },
] as const;
type View = (typeof VIEWS)[number]["id"];

function LegendKey({
  kind,
  label,
  lineColor,
}: {
  kind: "dot" | "ring";
  label: string;
  lineColor: string;
}) {
  return (
    <li className="flex items-center gap-1.5">
      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 shrink-0">
        {kind === "dot" && <circle cx={8} cy={8} r={5} fill={ACCENT} />}
        {kind === "ring" && (
          <circle
            cx={8}
            cy={8}
            r={4}
            fill={SURFACE}
            stroke={lineColor}
            strokeWidth={2}
          />
        )}
      </svg>
      {label}
    </li>
  );
}

// One measure over time: a line through the Days that have a value, with the gaps
// between them left as gaps. A chart | table switch shows the same points as a
// table instead, so nothing depends on hovering or on telling two colors apart.
export function TrendChart({
  title,
  measures,
  points,
  from,
  to,
  formatValue,
  fromZero,
  accentLabel,
  hollowLabel,
}: TrendChartProps) {
  const [view, setView] = useState<View>("chart");
  const lineColor = LINES[measures];
  const data = points.map((point) => ({ ...point, t: dayNumber(point.day) }));
  const byT = new Map(data.map((point) => [point.t, point]));
  const dense = data.length > MAX_DOTTED_POINTS;
  const legend = [
    data.some((point) => point.accent === true) && accentLabel !== undefined
      ? { kind: "dot" as const, label: accentLabel }
      : null,
    data.some((point) => point.hollow === true) && hollowLabel !== undefined
      ? { kind: "ring" as const, label: hollowLabel }
      : null,
  ].filter((key) => key !== null);
  const start = dayNumber(from);
  const end = dayNumber(to);
  // Over a long range the day of the month is noise; the year is what orients.
  const tickFormat = end - start > 180 ? MONTH_YEAR : MONTH_DAY;
  const yTicks = niceTicks(
    data.flatMap((point) => point.value ?? []),
    fromZero,
  );
  // Markers shrink when there are many, so a year of them does not smear together.
  const scale = dense ? 0.6 : 1;

  return (
    <figure className="flex flex-col gap-2 rounded-2xl border border-edge bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <figcaption className="font-semibold">{title}</figcaption>
        <Segments
          label={`${title} view`}
          options={VIEWS}
          value={view}
          onChange={setView}
          compact
        />
      </div>
      {view === "chart" && legend.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          {legend.map((key) => (
            <LegendKey
              key={key.kind}
              kind={key.kind}
              label={key.label}
              lineColor={lineColor}
            />
          ))}
        </ul>
      )}
      {/* The picture is for sighted readers; the table view carries the same data. */}
      {view === "chart" && (
        <div aria-hidden="true" className="h-56 select-none">
          <ResponsiveContainer
            width="100%"
            height="100%"
            initialDimension={{ width: 320, height: 224 }}
          >
            <ComposedChart
              data={data}
              margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
              accessibilityLayer={false}
            >
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis
                dataKey="t"
                type="number"
                domain={[start, end]}
                ticks={xTicks(start, end)}
                tickFormatter={(value: number) =>
                  tickFormat.format(value * MS_PER_DAY)
                }
                tick={{ fontSize: 12, fill: AXIS_TEXT }}
                tickLine={false}
                axisLine={{ stroke: GRID }}
              />
              <YAxis
                width={44}
                domain={[yTicks[0] ?? 0, yTicks.at(-1) ?? 1]}
                ticks={yTicks}
                tickFormatter={(value: number) => COMPACT.format(value)}
                tick={{ fontSize: 12, fill: AXIS_TEXT }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                cursor={{ stroke: AXIS_TEXT, strokeWidth: 1 }}
                isAnimationActive={false}
                content={({ active, label }) => {
                  const point = active ? byT.get(Number(label)) : undefined;
                  if (point?.value == null) {
                    return null;
                  }
                  return (
                    <div className="rounded-lg border border-edge bg-card px-3 py-2 text-sm shadow-md">
                      <p className="font-semibold text-ink">
                        {formatValue(point.value)}
                      </p>
                      <p className="text-muted">{formatDay(point.day)}</p>
                      {point.accent === true && accentLabel !== undefined && (
                        <p className="text-muted">{accentLabel}</p>
                      )}
                      {point.hollow === true && hollowLabel !== undefined && (
                        <p className="text-muted">{hollowLabel}</p>
                      )}
                      {point.detail !== undefined && (
                        <p className="text-muted">{point.detail}</p>
                      )}
                    </div>
                  );
                }}
              />
              <Line
                dataKey="value"
                stroke={lineColor}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                // A Day with no value is left off, and the line joins its neighbors.
                connectNulls
                isAnimationActive={false}
                activeDot={({ cx, cy, index }) => {
                  const point = data[index];
                  if (point === undefined || cx == null || cy == null) {
                    return null;
                  }
                  return (
                    <circle
                      key={point.day}
                      cx={cx}
                      cy={cy}
                      r={5}
                      fill={point.accent === true ? ACCENT : lineColor}
                      stroke={SURFACE}
                      strokeWidth={2}
                    />
                  );
                }}
                dot={({ cx, cy, index }) => {
                  const point = data[index];
                  if (
                    point === undefined ||
                    point.value === null ||
                    cx == null ||
                    cy == null
                  ) {
                    return null;
                  }
                  // An accent point and a ring are always drawn, however dense: each
                  // tells the reader something, so neither is decoration.
                  if (point.accent === true) {
                    return (
                      <circle
                        key={point.day}
                        cx={cx}
                        cy={cy}
                        r={5 * scale}
                        fill={ACCENT}
                        stroke={SURFACE}
                        strokeWidth={2 * scale}
                      />
                    );
                  }
                  if (point.hollow === true) {
                    return (
                      <circle
                        key={point.day}
                        cx={cx}
                        cy={cy}
                        r={4 * scale}
                        fill={SURFACE}
                        stroke={lineColor}
                        strokeWidth={2 * scale}
                      />
                    );
                  }
                  // A lone point has no line to show it, so it keeps its dot.
                  if (dense && data.length > 1) {
                    return null;
                  }
                  return (
                    <circle
                      key={point.day}
                      cx={cx}
                      cy={cy}
                      r={5}
                      fill={lineColor}
                      stroke={SURFACE}
                      strokeWidth={2}
                    />
                  );
                }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      {view === "table" && (
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{title}</caption>
          <thead className="text-faint">
            <tr>
              <th className="py-1 pr-2 font-medium">Day</th>
              <th className="py-1 pr-2 font-medium">{title}</th>
              <th className="py-1 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {/* Newest first, like every other list of Days in the app. */}
            {points.toReversed().map((point) => {
              const notes = [
                point.accent === true ? accentLabel : undefined,
                point.hollow === true ? hollowLabel : undefined,
                point.detail,
              ].filter((note) => note !== undefined);
              return (
                <tr key={point.day} className="border-t border-edge">
                  <td className="py-1 pr-2">
                    {formatDay(point.day)}
                    {point.day.slice(0, 4) !== to.slice(0, 4) &&
                      ` ${point.day.slice(0, 4)}`}
                  </td>
                  <td className="py-1 pr-2 tabular-nums">
                    {point.value === null ? "" : formatValue(point.value)}
                  </td>
                  <td className="py-1 text-muted">{notes.join(" · ")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </figure>
  );
}
