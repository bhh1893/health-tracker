// A Day is a calendar date written YYYY-MM-DD, as the API takes it (ADR 0006).

const DAY_FORMAT = /^(\d{4})-(\d{2})-(\d{2})$/;

// Built from local fields on purpose: toISOString() gives the UTC date, which is
// tomorrow every evening in the Americas.
export function toDay(date: Date) {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const dayOfMonth = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${dayOfMonth}`;
}

export function isValidDay(value: string) {
  const match = DAY_FORMAT.exec(value);
  if (!match) {
    return false;
  }
  const [, year, month, dayOfMonth] = match.map(Number);
  // Date rolls 2026-02-31 over to March, so an impossible date fails this check.
  const date = new Date(Number(year), Number(month) - 1, Number(dayOfMonth));
  return toDay(date) === value;
}

// Days as YYYY-MM-DD strings sort by date, so a plain comparison finds the future.
export function resolveViewedDay(param: string | null, today: string) {
  if (param === null || !isValidDay(param) || param > today) {
    return today;
  }
  return param;
}
