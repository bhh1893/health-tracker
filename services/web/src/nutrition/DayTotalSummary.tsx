import type { ReactNode } from "react";

import { formatKcal, formatMacros, type DayTotal } from "./totals";

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-900">
      {children}
    </span>
  );
}

// The viewed Day's calories and macros, at the top of the Meals window (ADR 0023).
// Two Days are not a plain sum, and each says so rather than pass as one: a
// Restaurant Day counts a flat value and its macros are unknown, and an Incomplete
// Day under-reports. The server never marks a Day as both.
export function DayTotalSummary({ total }: { total: DayTotal }) {
  return (
    <section
      aria-label="Day total"
      className="flex flex-col gap-1 rounded-2xl bg-gray-50 p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-lg font-semibold">{formatKcal(total.kcal)}</p>
        {total.restaurant_day && <Badge>Restaurant Day</Badge>}
        {total.incomplete && <Badge>Incomplete</Badge>}
      </div>
      {/* Null macros are unknown, not zero: "0 g" would be a false number. */}
      <p className="text-sm text-gray-600">
        {formatMacros(total) ?? "Macros: no data"}
      </p>
      {total.restaurant_day && (
        <p className="text-sm text-gray-600">
          Counted at your flat Restaurant Day value, whatever else was logged.
        </p>
      )}
      {total.incomplete && (
        <p className="text-sm text-gray-600">
          Some Foods have no Nutrition or Piece Weight yet, so the real total is
          higher.
        </p>
      )}
    </section>
  );
}
