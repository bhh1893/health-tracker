import { useState } from "react";
import { Button } from "react-aria-components";

import { DayPager } from "../components/DayPager";
import { ProblemAlert } from "../components/ProblemAlert";
import { formatDay } from "../lib/day";
import { defaultOccurredAt } from "../lib/occurred";
import { useViewedDay } from "../lib/useViewedDay";
import { uuidv7 } from "../lib/uuidv7";
import { DeleteSessionSheet } from "./DeleteSessionSheet";
import { newEntry, useAddSet, useDayEntries } from "./queries";
import { SessionCard } from "./SessionCard";
import { groupSessions, type ExerciseEntry, type Session } from "./sessions";
import { SetSheet } from "./SetSheet";

type Sheet =
  | { kind: "add"; previous?: ExerciseEntry }
  | { kind: "delete"; session: Session };

export function ExerciseWindow() {
  const { day, isToday } = useViewedDay();
  const entries = useDayEntries(day);
  const addSet = useAddSet();
  const [sheet, setSheet] = useState<Sheet | null>(null);

  const sessions = groupSessions(entries.data ?? []);

  function repeat(last: ExerciseEntry) {
    addSet.mutate(
      newEntry({
        id: uuidv7(),
        day,
        exercise: last.exercise,
        reps: last.reps,
        weight_lb: last.weight_lb,
        occurredAt: defaultOccurredAt(day, last.occurred_at),
      }),
    );
  }

  return (
    <main className="flex flex-col gap-4 pb-24">
      <h2 className="sr-only">Exercise on {day}</h2>
      <DayPager />
      {entries.error && <ProblemAlert error={entries.error} />}
      {addSet.error && <ProblemAlert error={addSet.error} />}
      {entries.isPending && <p className="text-gray-500">Loading...</p>}
      {entries.isSuccess && sessions.length === 0 && (
        <p className="text-gray-500">No Sets on this Day.</p>
      )}
      {sessions.map((session) => (
        <SessionCard
          key={session.exercise.id}
          session={session}
          onRepeat={repeat}
          onAddSet={(previous) => {
            setSheet({ kind: "add", previous });
          }}
          onDelete={() => {
            setSheet({ kind: "delete", session });
          }}
        />
      ))}

      <div className="fixed inset-x-0 bottom-0 mx-auto max-w-md p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <Button
          className="w-full rounded-2xl bg-teal-700 p-4 text-lg font-semibold text-white"
          onPress={() => {
            setSheet({ kind: "add" });
          }}
        >
          {isToday ? "Add Set" : `Add Set to ${formatDay(day)}`}
        </Button>
      </div>

      {sheet?.kind === "add" && (
        <SetSheet
          day={day}
          previous={sheet.previous}
          onClose={() => {
            setSheet(null);
          }}
        />
      )}
      {sheet?.kind === "delete" && (
        <DeleteSessionSheet
          day={day}
          session={sheet.session}
          onClose={() => {
            setSheet(null);
          }}
        />
      )}
    </main>
  );
}
