import { useState, type SyntheticEvent } from "react";
import { Button } from "react-aria-components";

import { BottomSheet } from "../components/BottomSheet";
import { fieldClass, labelClass } from "../components/formStyles";
import { ProblemAlert } from "../components/ProblemAlert";
import { formatDay } from "../lib/day";
import {
  afterSave,
  planWrites,
  rowIsValid,
  toRow,
  type SetRow,
  type SetWrite,
} from "./editSession";
import { useDeleteSet, useEditSet } from "./queries";
import { formatSet, type Session } from "./sessions";

interface EditSessionSheetProps {
  day: string;
  session: Session;
  onClose: () => void;
}

// Rows are local state, not the feed's Sets: Save updates the feed optimistically,
// and a failed row must keep what the user typed after the feed has rolled back.
export function EditSessionSheet({
  day,
  session,
  onClose,
}: EditSessionSheetProps) {
  const [rows, setRows] = useState(() => session.sets.map(toRow));
  const [failure, setFailure] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const editSet = useEditSet();
  const deleteSet = useDeleteSet();

  function updateRow(id: string, change: Partial<SetRow>) {
    setRows((current) =>
      current.map((row) =>
        row.saved.id === id ? { ...row, ...change, failed: false } : row,
      ),
    );
  }

  function send({ before, after }: SetWrite): Promise<unknown> {
    return after === null
      ? deleteSet.mutateAsync(before)
      : editSet.mutateAsync({ before, after });
  }

  async function save(event: SyntheticEvent) {
    event.preventDefault();
    if (!rows.every(rowIsValid)) {
      return;
    }
    const writes = planWrites(rows);
    if (writes.length === 0) {
      onClose();
      return;
    }

    setSaving(true);
    setFailure(null);
    const failures = new Map<string, unknown>();
    await Promise.all(
      writes.map((write) =>
        send(write).catch((reason: unknown) => {
          failures.set(write.before.id, reason);
        }),
      ),
    );
    setSaving(false);

    if (failures.size === 0) {
      onClose();
      return;
    }
    // Stays open. Retrying is safe: every PUT and DELETE is idempotent (ADR 0008).
    setRows(afterSave(rows, writes, new Set(failures.keys())));
    setFailure([...failures.values()][0]);
  }

  return (
    <BottomSheet
      title={`Edit ${session.exercise.name} on ${formatDay(day)}`}
      onClose={onClose}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          void save(event);
        }}
      >
        {rows.map((row, index) => {
          const name = `Set ${String(index + 1)}`;
          const { id } = row.saved;
          return (
            // A fieldset is a labelled group, and disabling it disables all it holds.
            <fieldset
              key={id}
              aria-label={name}
              disabled={saving}
              className="flex flex-col gap-2 border-b border-gray-100 pb-4"
            >
              <div className="flex items-center justify-between">
                <span
                  className={row.removed ? "text-gray-400 line-through" : ""}
                >
                  {name}
                  {row.removed && ` ${formatSet(row.saved)}`}
                </span>
                {row.failed && (
                  <span className="text-sm text-red-900">Not saved</span>
                )}
                <Button
                  aria-label={`${row.removed ? "Undo" : "Delete"} ${name}`}
                  className="rounded-lg p-2 text-base text-teal-700"
                  onPress={() => {
                    updateRow(id, { removed: !row.removed });
                  }}
                >
                  {row.removed ? "Undo" : "Delete"}
                </Button>
              </div>
              {!row.removed && (
                <div className="grid grid-cols-[auto_1fr_1fr] gap-2">
                  <label className={labelClass}>
                    Time
                    <input
                      type="time"
                      required
                      className={fieldClass}
                      value={row.time}
                      onChange={({ target }) => {
                        updateRow(id, { time: target.value });
                      }}
                    />
                  </label>
                  <label className={labelClass}>
                    Weight (lb)
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      placeholder="BW"
                      className={fieldClass}
                      value={row.weight}
                      onChange={({ target }) => {
                        updateRow(id, { weight: target.value });
                      }}
                    />
                  </label>
                  <label className={labelClass}>
                    Reps
                    <input
                      type="number"
                      inputMode="numeric"
                      min="1"
                      step="1"
                      required
                      className={fieldClass}
                      value={row.reps}
                      onChange={({ target }) => {
                        updateRow(id, { reps: target.value });
                      }}
                    />
                  </label>
                </div>
              )}
            </fieldset>
          );
        })}
        {failure !== null && <ProblemAlert error={failure} />}
        <div className="sticky bottom-0 grid grid-cols-2 gap-3 bg-white py-2">
          <Button
            className="rounded-xl p-3 text-base text-gray-600"
            onPress={onClose}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            className="rounded-xl bg-teal-700 p-3 text-base font-semibold text-white data-disabled:bg-gray-300"
            isDisabled={saving || !rows.every(rowIsValid)}
          >
            Save
          </Button>
        </div>
      </form>
    </BottomSheet>
  );
}
