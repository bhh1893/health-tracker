import { toDay } from "./day";

// When a Set happened (ADR 0006): an instant with an offset, plus the IANA zone
// the server uses to work out its Day.

const pad = (value: number) => String(value).padStart(2, "0");

export function currentTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

// "HH:mm", the value a time input holds.
export function timeOfDay(date: Date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// toISOString() would also be valid RFC 3339, but it says UTC, and the feed shows
// the clock time written in occurred_at.
export function toRfc3339(date: Date) {
  const minutesEast = -date.getTimezoneOffset();
  const sign = minutesEast < 0 ? "-" : "+";
  const offsetHours = pad(Math.floor(Math.abs(minutesEast) / 60));
  const offsetMinutes = pad(Math.abs(minutesEast) % 60);
  const clock = `${timeOfDay(date)}:${pad(date.getSeconds())}`;
  return `${toDay(date)}T${clock}${sign}${offsetHours}:${offsetMinutes}`;
}

// A local clock time on a Day. Date() reads its fields as local time, which is the
// time the user typed.
export function onDay(day: string, time: string, seconds = 0) {
  const [year, month, dayOfMonth] = day.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(dayOfMonth),
    hours,
    minutes,
    seconds,
  );
}

// The zone's offset at a moment, as RFC 3339 writes it. Intl says "GMT+13:00", or
// plain "GMT" at zero.
function offsetIn(timeZone: string, at: Date) {
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  })
    .formatToParts(at)
    .find(({ type }) => type === "timeZoneName")?.value;
  return name === undefined || name === "GMT" ? "+00:00" : name.slice(3);
}

// A Set moved to another clock time on its own date, in its own zone: an edit made
// while travelling must not shift the Set by the phone's offset. The offset is looked
// up again because the new time can fall on the other side of a daylight saving
// change, and the server would then show a different clock time from the one typed.
export function withClockTime(
  occurredAt: string,
  occurredTz: string,
  time: string,
) {
  const clock = `${occurredAt.slice(0, 11)}${time}:00`;
  const nearby = new Date(`${clock}${occurredAt.slice(19)}`);
  return `${clock}${offsetIn(occurredTz, nearby)}`;
}

// Now, moved onto the viewed Day (ADR 0013). A Set added to a past Day in the morning
// can land before that Day's evening Sets, so a repeat goes just after the Set it
// follows: otherwise "repeat" would insert above the Set it copied.
export function defaultOccurredAt(
  day: string,
  previous: string | null,
  now: Date = new Date(),
) {
  const candidate =
    day === toDay(now) ? now : onDay(day, timeOfDay(now), now.getSeconds());
  if (previous === null) {
    return candidate;
  }
  const previousAt = new Date(previous);
  return previousAt >= candidate
    ? new Date(previousAt.getTime() + 1000)
    : candidate;
}
