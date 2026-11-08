import { formatSet, type ExerciseEntry } from "./sessions";

// One Session's Sets, numbered by position. Shared by the editable Session card and
// Search's read-only view, which both hold every Set of the Session for the Day.
export function SetList({ sets }: { sets: ExerciseEntry[] }) {
  return (
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
  );
}
