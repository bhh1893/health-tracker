import { Link } from "react-router";

import { useViewedDay } from "../lib/useViewedDay";

// Empty on purpose: #66, #67 and #68 replace these with the real screens.

export function ExerciseWindow() {
  const { day } = useViewedDay();
  return (
    <main>
      <h2 className="text-lg font-semibold">Exercise on {day}</h2>
    </main>
  );
}

export function MealsWindow() {
  const { day } = useViewedDay();
  return (
    <main>
      <h2 className="text-lg font-semibold">Meals on {day}</h2>
    </main>
  );
}

export function SearchScreen() {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-4">
      <Link className="text-teal-700 underline" to="/exercise">
        Back
      </Link>
      <h1 className="text-xl font-semibold">Search</h1>
    </main>
  );
}
