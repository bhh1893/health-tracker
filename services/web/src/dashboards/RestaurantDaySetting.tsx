import { useState } from "react";
import { Button, Input, Label, NumberField } from "react-aria-components";

import { ProblemAlert } from "../components/ProblemAlert";
import { fieldClass, labelClass } from "../components/formStyles";
import { useSetRestaurantDayKcal } from "./queries";

// The API's bounds on restaurant_day_kcal (ADR 0023).
const MAX_KCAL = 10_000;

// The one number every Restaurant Day counts as. Changing it moves every past
// Restaurant Day too, because Day Totals are computed on read (ADR 0023).
// Mounted once the saved value is known, so the field starts from it.
export function RestaurantDaySetting({ saved }: { saved: number }) {
  const [kcal, setKcal] = useState(saved);
  const save = useSetRestaurantDayKcal();
  const valid = Number.isFinite(kcal) && kcal >= 0 && kcal <= MAX_KCAL;

  return (
    <form
      className="flex flex-col gap-2 rounded-2xl border border-gray-200 bg-white p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) {
          save.mutate(kcal);
        }
      }}
    >
      <div className="flex items-end gap-2">
        <NumberField
          className={`${labelClass} flex-1`}
          value={kcal}
          minValue={0}
          maxValue={MAX_KCAL}
          onChange={setKcal}
        >
          <Label>Restaurant Day calories</Label>
          <Input className={fieldClass} inputMode="numeric" />
        </NumberField>
        <Button
          type="submit"
          isDisabled={!valid || kcal === saved || save.isPending}
          className="rounded-xl bg-teal-700 px-4 py-3 text-base text-white data-disabled:bg-gray-300"
        >
          Save
        </Button>
      </div>
      <p className="text-sm text-gray-600">
        Any Day with a Restaurant Meal counts as this many calories, whatever
        else was logged. Changing it changes past Days too.
      </p>
      {save.error && <ProblemAlert error={save.error} />}
    </form>
  );
}
