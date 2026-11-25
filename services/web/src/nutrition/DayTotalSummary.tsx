import type { ReactNode } from "react";
import { Link } from "react-router";

import { formatKcal, formatMacros, type DayTotal } from "./totals";

// "warn" flags a total to read with care. "restaurant" is the Restaurant color on a
// card-colored pill, since the section behind it already has the pink tint.
const TONES = {
  warn: "bg-warn-soft text-warn-ink",
  restaurant: "bg-card text-restaurant-ink",
};

const badgeClass = "shrink-0 rounded-full px-3 py-1 text-sm font-semibold";

function Badge({
  tone,
  children,
}: {
  tone: keyof typeof TONES;
  children: ReactNode;
}) {
  return <span className={`${badgeClass} ${TONES[tone]}`}>{children}</span>;
}

// A deep link: the URL carries the filter, so the Foods page opens already showing
// only the Foods that need a label (ADR 0032). Back returns to this Day.
const MISSING_FOODS = "/profile/foods?missing=1";

const sectionClass = "flex flex-col gap-1 rounded-2xl p-4";

// The viewed Day's calories and macros, at the top of the Meals window (ADR 0023).
// Two Days are not a plain sum, and each says so rather than pass as one. A
// Restaurant Day shows no numbers at all: the Day is not being tracked, and its
// flat value would read like a real count. An Incomplete Day under-reports. The
// server never marks a Day as both.
export function DayTotalSummary({ total }: { total: DayTotal }) {
  if (total.restaurant_day) {
    return (
      <section
        aria-label="Day total"
        className={`${sectionClass} bg-restaurant-soft`}
      >
        <div>
          <Badge tone="restaurant">ate out</Badge>
        </div>
        <p className="text-sm text-muted">
          Not tracking, has become a cheat day.
        </p>
      </section>
    );
  }
  return (
    <section aria-label="Day total" className={`${sectionClass} bg-food-soft`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-lg font-semibold">{formatKcal(total.kcal)}</p>
        {total.incomplete && (
          <Link to={MISSING_FOODS} className={`${badgeClass} ${TONES.warn}`}>
            Incomplete <span aria-hidden="true">›</span>
          </Link>
        )}
      </div>
      {/* Null macros are unknown, not zero: "0 g" would be a false number. */}
      <p className="text-sm text-muted">
        {formatMacros(total) ?? "Macros: no data"}
      </p>
      {total.incomplete && (
        <p className="text-sm text-muted">
          Some Foods have no Nutrition or Piece Weight yet, so the real total is
          higher. Tap Incomplete to finish them.
        </p>
      )}
    </section>
  );
}
