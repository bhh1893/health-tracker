import type { ReactNode } from "react";

import { formatKcal, formatMacros, type DayTotal } from "./totals";

// Amber flags a total to read with care; orange is the Restaurant colour, the same
// as History's "ate out" pill and the Dashboard's orange points.
const TONES = {
  amber: "bg-amber-100 text-amber-900",
  orange: "bg-orange-100 text-orange-800",
};

function Badge({
  tone,
  children,
}: {
  tone: keyof typeof TONES;
  children: ReactNode;
}) {
  return (
    <span
      className={`shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

const sectionClass = "flex flex-col gap-1 rounded-2xl bg-gray-50 p-4";

// The viewed Day's calories and macros, at the top of the Meals window (ADR 0023).
// Two Days are not a plain sum, and each says so rather than pass as one. A
// Restaurant Day shows no numbers at all: the Day is not being tracked, and its
// flat value would read like a real count. An Incomplete Day under-reports. The
// server never marks a Day as both.
export function DayTotalSummary({ total }: { total: DayTotal }) {
  if (total.restaurant_day) {
    return (
      <section aria-label="Day total" className={sectionClass}>
        <div>
          <Badge tone="orange">ate out</Badge>
        </div>
        <p className="text-sm text-gray-600">
          Not tracking, has become a cheat day.
        </p>
      </section>
    );
  }
  return (
    <section aria-label="Day total" className={sectionClass}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-lg font-semibold">{formatKcal(total.kcal)}</p>
        {total.incomplete && <Badge tone="amber">Incomplete</Badge>}
      </div>
      {/* Null macros are unknown, not zero: "0 g" would be a false number. */}
      <p className="text-sm text-gray-600">
        {formatMacros(total) ?? "Macros: no data"}
      </p>
      {total.incomplete && (
        <p className="text-sm text-gray-600">
          Some Foods have no Nutrition or Piece Weight yet, so the real total is
          higher.
        </p>
      )}
    </section>
  );
}
