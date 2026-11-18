import type { Picked } from "../search/searchQuery";
import { ExerciseDashboard } from "./ExerciseDashboard";
import { MealsDashboard } from "./MealsDashboard";

export interface DashboardProps {
  // The picked Exercise, or null for the Meals dashboard.
  exercise: Picked | null;
  // Null means all of history.
  from: string | null;
  to: string;
}

// The body of History's Dashboard section (ADR 0024's tiles and charts), and the
// entry of its own chunk: History imports this file with import() the first time
// the section opens, so the chart library loads then and not with History
// (ADR 0033). Nothing outside this folder may import it statically, or the chart
// library would join the main bundle again.
export default function Dashboard({ exercise, from, to }: DashboardProps) {
  return exercise === null ? (
    <MealsDashboard from={from} to={to} />
  ) : (
    <ExerciseDashboard
      // Remounted per Exercise, so one's chart never shows under another's name.
      key={exercise.id}
      exerciseId={exercise.id}
      from={from}
      to={to}
    />
  );
}
