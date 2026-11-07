import { Button } from "react-aria-components";

import { formatSet, type ExerciseEntry, type Session } from "./sessions";

interface SessionCardProps {
  session: Session;
  onRepeat: (last: ExerciseEntry) => void;
  onAddSet: (last: ExerciseEntry) => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function SessionCard({
  session,
  onRepeat,
  onAddSet,
  onEdit,
  onDelete,
}: SessionCardProps) {
  const { exercise, sets } = session;
  const last = sets.at(-1);
  if (last === undefined) {
    return null;
  }

  return (
    <article
      aria-label={exercise.name}
      className="rounded-2xl border border-gray-200 bg-white p-3"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{exercise.name}</h3>
        <div className="flex items-center">
          <Button
            aria-label={`Edit ${exercise.name}`}
            className="rounded-lg p-2 text-base text-teal-700"
            onPress={onEdit}
          >
            Edit
          </Button>
          <Button
            aria-label={`Delete ${exercise.name} for the Day`}
            className="rounded-lg p-2 text-gray-500"
            onPress={onDelete}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
            </svg>
          </Button>
        </div>
      </div>
      <ol className="flex flex-col">
        {sets.map((set, index) => (
          <li
            key={set.id}
            className="flex justify-between border-b border-gray-100 py-2"
          >
            <span>
              <span className="text-gray-500">Set {index + 1}</span>{" "}
              {formatSet(set)}
            </span>
            {/* occurred_at is written in the Set's own zone, so this is the clock
                time where it happened, wherever the phone is now. */}
            <span className="text-sm text-gray-500">
              {set.occurred_at.slice(11, 16)}
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Button
          className="rounded-xl border-2 border-dashed border-teal-400 p-2 text-base text-teal-700 data-pressed:bg-teal-50"
          onPress={() => {
            onRepeat(last);
          }}
        >
          + {formatSet(last)}
        </Button>
        <Button
          className="rounded-xl border-2 border-teal-700 p-2 text-base text-teal-700 data-pressed:bg-teal-50"
          onPress={() => {
            onAddSet(last);
          }}
        >
          + Set {sets.length + 1}
        </Button>
      </div>
    </article>
  );
}
