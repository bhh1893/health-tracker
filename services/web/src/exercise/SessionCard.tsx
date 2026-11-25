import { Button } from "react-aria-components";

import { PencilIcon } from "../components/PencilIcon";

import { formatSet, type ExerciseEntry, type Session } from "./sessions";
import { SetList } from "./SetList";

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
      className="rounded-2xl border border-edge bg-card p-3"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{exercise.name}</h3>
        <div className="flex items-center">
          <Button
            aria-label={`Edit ${exercise.name}`}
            className="rounded-lg p-2 text-action data-pressed:bg-action-soft"
            onPress={onEdit}
          >
            <PencilIcon />
          </Button>
          <Button
            aria-label={`Delete ${exercise.name} for the Day`}
            className="rounded-lg p-2 text-faint"
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
      <SetList sets={sets} />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Button
          className="rounded-xl border-2 border-dashed border-action p-2 text-base text-action data-pressed:bg-action-soft"
          onPress={() => {
            onRepeat(last);
          }}
        >
          + {formatSet(last)}
        </Button>
        <Button
          className="rounded-xl border-2 border-action p-2 text-base text-action data-pressed:bg-action-soft"
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
