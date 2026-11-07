import { useState, type SyntheticEvent } from "react";
import { Button } from "react-aria-components";

import { CatalogComboBox } from "../catalog/CatalogComboBox";
import { exerciseCatalog, type CatalogItem } from "../catalog/catalogs";
import { BottomSheet } from "../components/BottomSheet";
import { fieldClass, labelClass } from "../components/formStyles";
import { ProblemAlert } from "../components/ProblemAlert";
import { formatDay } from "../lib/day";
import { defaultOccurredAt, onDay, timeOfDay } from "../lib/occurred";
import { uuidv7 } from "../lib/uuidv7";
import { newEntry, useAddSet } from "./queries";
import { parseSetFields, type ExerciseEntry } from "./sessions";

interface SetSheetProps {
  day: string;
  // The Session's latest Set, when opened from a Session card.
  previous?: ExerciseEntry | undefined;
  onClose: () => void;
}

export function SetSheet({ day, previous, onClose }: SetSheetProps) {
  // One id per opening of the sheet, not per tap of Save. If a save fails after the
  // server stored it, saving again replaces that Set instead of adding a second one.
  const [id] = useState(uuidv7);
  const [defaultAt] = useState(() =>
    defaultOccurredAt(day, previous?.occurred_at ?? null),
  );
  const [time, setTime] = useState(timeOfDay(defaultAt));
  const [picked, setPicked] = useState<CatalogItem | null>(
    previous?.exercise ?? null,
  );
  const [weight, setWeight] = useState(previous?.weight_lb?.toString() ?? "");
  const [reps, setReps] = useState(previous?.reps.toString() ?? "");
  const addSet = useAddSet();

  const fields = parseSetFields(weight, reps);

  function save(event: SyntheticEvent) {
    event.preventDefault();
    if (picked === null || time === "" || fields === null) {
      return;
    }
    addSet.mutate(
      newEntry({
        id,
        day,
        exercise: picked,
        ...fields,
        // Untouched, keep the seconds: Sets logged in the same minute stay in order.
        occurredAt:
          time === timeOfDay(defaultAt) ? defaultAt : onDay(day, time),
      }),
      { onSuccess: onClose },
    );
  }

  return (
    <BottomSheet title={`Add Set to ${formatDay(day)}`} onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={save}>
        <div className="grid grid-cols-[auto_1fr] gap-3">
          <label className={labelClass}>
            Time
            <input
              type="time"
              required
              className={fieldClass}
              value={time}
              onChange={({ target }) => {
                setTime(target.value);
              }}
            />
          </label>
          <CatalogComboBox
            catalog={exerciseCatalog}
            value={picked}
            onChange={setPicked}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className={labelClass}>
            Weight (lb)
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              placeholder="Bodyweight"
              className={fieldClass}
              value={weight}
              onChange={({ target }) => {
                setWeight(target.value);
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
              value={reps}
              onChange={({ target }) => {
                setReps(target.value);
              }}
            />
          </label>
        </div>
        {addSet.error && <ProblemAlert error={addSet.error} />}
        <div className="grid grid-cols-2 gap-3">
          <Button
            className="rounded-xl p-3 text-base text-gray-600"
            onPress={onClose}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            className="rounded-xl bg-teal-700 p-3 text-base font-semibold text-white data-disabled:bg-gray-300"
            isDisabled={picked === null || fields === null || addSet.isPending}
          >
            Save
          </Button>
        </div>
      </form>
    </BottomSheet>
  );
}
