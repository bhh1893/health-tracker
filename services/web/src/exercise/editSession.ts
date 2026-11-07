import { withClockTime } from "../lib/occurred";
import { parseSetFields, type ExerciseEntry } from "./sessions";

// One Set in the Edit Session sheet: the text in its inputs, beside the version the
// server holds. The difference between the two is all that Save ever sends.
export interface SetRow {
  saved: ExerciseEntry;
  time: string;
  weight: string;
  reps: string;
  removed: boolean;
  failed: boolean;
}

// `after` is what the Set becomes; null deletes it.
export interface SetWrite {
  before: ExerciseEntry;
  after: ExerciseEntry | null;
}

// occurred_at is written in the Set's own zone, so these are the clock digits the
// feed shows, wherever the phone is now.
const clockTime = (set: ExerciseEntry) => set.occurred_at.slice(11, 16);

export function toRow(saved: ExerciseEntry): SetRow {
  return {
    saved,
    time: clockTime(saved),
    weight: saved.weight_lb?.toString() ?? "",
    reps: saved.reps.toString(),
    removed: false,
    failed: false,
  };
}

export function rowIsValid(row: SetRow) {
  return (
    row.removed ||
    (row.time !== "" && parseSetFields(row.weight, row.reps) !== null)
  );
}

// Compares values, not text: "135.0" over a saved 135 is no change. An untouched
// time keeps its seconds, which hold Sets logged in the same minute in order.
function edited(row: SetRow): ExerciseEntry | null {
  const { saved, time } = row;
  const fields = parseSetFields(row.weight, row.reps);
  if (fields === null) {
    return null;
  }
  const sameTime = time === clockTime(saved);
  if (
    sameTime &&
    fields.reps === saved.reps &&
    fields.weight_lb === saved.weight_lb
  ) {
    return null;
  }
  return {
    ...saved,
    ...fields,
    occurred_at: sameTime
      ? saved.occurred_at
      : withClockTime(saved.occurred_at, saved.occurred_tz, time),
  };
}

export function planWrites(rows: SetRow[]) {
  return rows.flatMap((row): SetWrite[] => {
    if (row.removed) {
      return [{ before: row.saved, after: null }];
    }
    const after = edited(row);
    return after === null ? [] : [{ before: row.saved, after }];
  });
}

// Moves each row to what the server now holds. A write that landed stops being a
// difference, so the next planWrites sends only what failed: retry is just Save.
export function afterSave(
  rows: SetRow[],
  writes: SetWrite[],
  failedIds: ReadonlySet<string>,
) {
  const sent = new Map(writes.map((write) => [write.before.id, write]));
  return rows.flatMap((row): SetRow[] => {
    const write = sent.get(row.saved.id);
    if (write === undefined) {
      return [row];
    }
    if (failedIds.has(row.saved.id)) {
      return [{ ...row, failed: true }];
    }
    return write.after === null ? [] : [toRow(write.after)];
  });
}
