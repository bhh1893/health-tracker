import type { ExerciseSession } from "../exercise/sessions";
import { useExerciseDays } from "./queries";
import { DayRow, RecentDays } from "./RecentDays";

interface ExerciseDaysProps {
  exerciseId: string;
  from: string | null;
  to: string;
}

// Recent Days on Exercise: each Day in the Range with a Session of the picked
// Exercise, listing its Sets (ADR 0033). One Session per Day (ADR 0024).
export function ExerciseDays({ exerciseId, from, to }: ExerciseDaysProps) {
  const pages = useExerciseDays(exerciseId, from, to);
  return (
    <RecentDays
      pages={pages}
      empty="No Sessions in this range."
      renderDay={(session) => (
        <DayRow key={session.day} day={session.day}>
          <SetList session={session} />
        </DayRow>
      )}
    />
  );
}

// "Set 1 ... 5 reps · 205 lb", numbered by the server in the order they were done.
function SetList({ session }: { session: ExerciseSession }) {
  return (
    <ol className="px-3 pb-2">
      {session.sets.map((set) => (
        <li key={set.number} className="flex justify-between gap-3 py-1.5">
          <span>Set {set.number}</span>
          <span className="whitespace-nowrap text-muted">
            {formatReps(set.reps)} · {formatWeight(set.weight_lb)}
          </span>
        </li>
      ))}
    </ol>
  );
}

const formatReps = (reps: number) =>
  `${String(reps)} ${reps === 1 ? "rep" : "reps"}`;

// BW, as everywhere else a Set is written (formatSet), for a bodyweight Set.
const formatWeight = (weight: number | null) =>
  weight === null ? "BW" : `${String(weight)} lb`;
