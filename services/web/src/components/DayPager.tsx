import type { MouseEvent } from "react";
import { Button } from "react-aria-components";

import { addDays, formatDay } from "../lib/day";
import { useViewedDay } from "../lib/useViewedDay";

const stepClass =
  "rounded-lg px-4 py-2 text-2xl text-teal-700 data-disabled:text-gray-300";

// Desktop browsers open the picker only from their small calendar icon. The input
// covers the whole date here, so ask for the picker on any click.
function openPicker(event: MouseEvent<HTMLInputElement>) {
  event.currentTarget.showPicker();
}

// ADR 0013. The Day stays in the URL, so this holds no state of its own.
export function DayPager() {
  const { day, today, isToday, setDay } = useViewedDay();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Button
          aria-label="Previous Day"
          className={stepClass}
          onPress={() => {
            setDay(addDays(day, -1));
          }}
        >
          ‹
        </Button>
        {/* The native picker, invisible, laid over the date: the phone's own date
            wheel for free, with the styled text showing through. */}
        <label className="relative flex-1 text-center text-lg font-semibold">
          {isToday ? `Today, ${formatDay(day)}` : formatDay(day)}
          <input
            type="date"
            aria-label="Choose Day"
            className="absolute inset-0 w-full text-base opacity-0"
            value={day}
            max={today}
            onClick={openPicker}
            onChange={({ target }) => {
              // A picker's Clear button sends an empty value.
              if (target.value !== "") {
                setDay(target.value);
              }
            }}
          />
        </label>
        <Button
          aria-label="Next Day"
          className={stepClass}
          isDisabled={isToday}
          onPress={() => {
            setDay(addDays(day, 1));
          }}
        >
          ›
        </Button>
      </div>
      {!isToday && (
        <Button
          className="rounded-xl bg-amber-50 p-2 text-base text-amber-900"
          onPress={() => {
            setDay(today);
          }}
        >
          Viewing a past Day, tap to jump to Today
        </Button>
      )}
    </div>
  );
}
