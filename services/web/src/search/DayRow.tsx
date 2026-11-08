import {
  Button,
  Disclosure,
  DisclosurePanel,
  Heading,
} from "react-aria-components";
import { Link } from "react-router";

import { SetList } from "../exercise/SetList";
import type { Session } from "../exercise/sessions";
import { formatDay } from "../lib/day";
import { MealContents } from "../meals/MealContents";
import { clockTime, mealName, type Meal } from "../meals/meals";
import { summarize, type DayResult } from "./days";

const linkClass = "text-base text-teal-700 underline";

// Read-only on purpose: Search answers questions, the Day windows change data
// (ADR 0013). Fixing an Entry is one tap away through "Open in ...".
function SessionView({ session }: { session: Session }) {
  return (
    <article
      aria-label={session.exercise.name}
      className="rounded-xl border border-gray-200 p-3"
    >
      <h4 className="font-semibold">{session.exercise.name}</h4>
      <SetList sets={session.sets} />
    </article>
  );
}

// The server's Meal number, not the position here: filtered by a Food, this Day's
// other Meals are not loaded, so the second Meal of the Day may be the only one.
function MealView({ meal }: { meal: Meal }) {
  const name = mealName(meal.number, meal.label);
  return (
    <article
      aria-label={name}
      className="rounded-xl border border-gray-200 p-3"
    >
      <div className="flex items-baseline justify-between">
        <h4 className="font-semibold">{name}</h4>
        <span className="text-sm text-gray-500">{clockTime(meal)}</span>
      </div>
      <MealContents meal={meal} />
    </article>
  );
}

// One Day, collapsed to a summary line until tapped (ADR 0013), so a month of
// results stays about one screen long.
export function DayRow({ result }: { result: DayResult }) {
  const { day, sessions, meals } = result;
  const dayParam = `?day=${day}`;
  return (
    <Disclosure className="rounded-2xl border border-gray-200 bg-white">
      <Heading level={3}>
        <Button
          slot="trigger"
          // Spoken as "Fri Nov 6, 2 sets": the two spans alone would run together
          // as "Fri Nov 62 sets".
          aria-label={`${formatDay(day)}, ${summarize(result)}`}
          className="flex w-full items-baseline justify-between gap-2 p-3 text-left"
        >
          <span className="font-semibold">{formatDay(day)}</span>
          <span className="text-sm text-gray-600">{summarize(result)}</span>
        </Button>
      </Heading>
      <DisclosurePanel className="flex flex-col gap-2 px-3 pb-3">
        {sessions.map((session) => (
          <SessionView key={session.exercise.id} session={session} />
        ))}
        {meals.map((meal) => (
          <MealView key={meal.id} meal={meal} />
        ))}
        <div className="flex gap-4">
          {sessions.length > 0 && (
            <Link className={linkClass} to={`/exercise${dayParam}`}>
              Open in Exercise
            </Link>
          )}
          {meals.length > 0 && (
            <Link className={linkClass} to={`/meals${dayParam}`}>
              Open in Meals
            </Link>
          )}
        </div>
      </DisclosurePanel>
    </Disclosure>
  );
}
