import {
  Button,
  Disclosure,
  DisclosurePanel,
  Heading,
} from "react-aria-components";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatDay } from "../lib/day";
import { niceTicks } from "./scale";

// Chart colors: the first two slots of a palette checked for colorblind-safe
// separation and for contrast on white. Text never wears them (ADR 0024).
const BLUE = "#2a78d6";
const ORANGE = "#eb6834";
const SURFACE = "#ffffff";
const GRID = "#e5e7eb";
const AXIS_TEXT = "#6b7280";

// Above this many points a dot on each one is clutter, and the line alone reads better.
const MAX_DOTTED_POINTS = 45;
const X_TICKS = 4;
const MS_PER_DAY = 86_400_000;

// One Day on the chart, drawn on the line at `value`.
export interface TrendPoint {
  day: string;
  value: number | null;
  // Drawn in orange: a Day of another kind on the same line, such as a Restaurant
  // Day. Its kind is a property of the point, not a second series (ADR 0033).
  accent?: boolean;
  // Drawn as a ring instead of a filled dot: the value under-reports.
  hollow?: boolean;
  // Extra lines for the tooltip and the table, such as the Sets or the macros.
  detail?: string | undefined;
}

interface TrendChartProps {
  title: string;
  points: TrendPoint[];
  // The Days the x axis spans, both included, so a quiet week shows as a gap.
  from: string;
  to: string;
  formatValue: (value: number) => string;
  // Calories are an amount, read against zero. A top Set or a Session's volume is
  // read by its change, which a zero baseline would flatten into a straight line.
  fromZero: boolean;
  // Names an accent point in the tooltip and the table. The legend leaves it out:
  // the screen around the chart explains the orange (ADR 0033).
  accentLabel?: string;
  // Named in the legend only when the chart has such points.
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

function LegendKey({ kind, label }: { kind: "line" | "ring"; label: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 shrink-0">
        {kind === "line" && (
          <path
            d="M1 8H15"
            stroke={BLUE}
            strokeWidth={2}
            strokeLinecap="round"
          />
        )}
        {kind === "ring" && (
          <circle
            cx={8}
            cy={8}
            r={4}
            fill={SURFACE}
            stroke={BLUE}
            strokeWidth={2}
          />
        )}
      </svg>
      {label}
    </li>
  );
}

// One measure over time: a line through the Days that have a value, with the gaps
// between them left as gaps. Every number on it is also in the table underneath,
// so nothing depends on hovering or on telling two colors apart.
export function TrendChart({
  title,
  points,
  from,
  to,
  formatValue,
  fromZero,
  accentLabel,
  hollowLabel,
}: TrendChartProps) {
  const data = points.map((point) => ({ ...point, t: dayNumber(point.day) }));
  const byT = new Map(data.map((point) => [point.t, point]));
  const dense = data.length > MAX_DOTTED_POINTS;
  const hasHollow = data.some((point) => point.hollow === true);
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
    <figure className="flex flex-col gap-2 rounded-2xl border border-gray-200 bg-white p-3">
      <figcaption className="font-semibold">{title}</figcaption>
      {hasHollow && hollowLabel !== undefined && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
          <LegendKey kind="line" label={title} />
          <LegendKey kind="ring" label={hollowLabel} />
        </ul>
      )}
      {/* The picture is for sighted readers; the table below carries the same data. */}
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
                  <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-md">
                    <p className="font-semibold text-gray-900">
                      {formatValue(point.value)}
                    </p>
                    <p className="text-gray-600">{formatDay(point.day)}</p>
                    {point.accent === true && accentLabel !== undefined && (
                      <p className="text-gray-600">{accentLabel}</p>
                    )}
                    {point.hollow === true && hollowLabel !== undefined && (
                      <p className="text-gray-600">{hollowLabel}</p>
                    )}
                    {point.detail !== undefined && (
                      <p className="text-gray-600">{point.detail}</p>
                    )}
                  </div>
                );
              }}
            />
            <Line
              dataKey="value"
              stroke={BLUE}
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
                    fill={point.accent === true ? ORANGE : BLUE}
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
                      fill={ORANGE}
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
                      stroke={BLUE}
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
                    fill={BLUE}
                    stroke={SURFACE}
                    strokeWidth={2}
                  />
                );
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <Disclosure>
        <Heading level={3}>
          <Button slot="trigger" className="text-sm text-teal-700 underline">
            {title} as a table
          </Button>
        </Heading>
        <DisclosurePanel>
          <table className="mt-2 w-full text-left text-sm">
            <caption className="sr-only">{title}</caption>
            <thead className="text-gray-500">
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
                  <tr key={point.day} className="border-t border-gray-100">
                    <td className="py-1 pr-2">
                      {formatDay(point.day)}
                      {point.day.slice(0, 4) !== to.slice(0, 4) &&
                        ` ${point.day.slice(0, 4)}`}
                    </td>
                    <td className="py-1 pr-2 tabular-nums">
                      {point.value === null ? "" : formatValue(point.value)}
                    </td>
                    <td className="py-1 text-gray-600">{notes.join(" · ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DisclosurePanel>
      </Disclosure>
    </figure>
  );
}
