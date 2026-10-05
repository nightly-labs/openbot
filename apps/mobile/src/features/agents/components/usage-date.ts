/** Noon of a `YYYY-MM-DD` day in the phone's time zone, so a picker shows the same day. */
export function localDate(day: string): Date {
  const [year = 1970, month = 1, date = 1] = day.split("-").map(Number);
  return new Date(year, month - 1, date, 12);
}

/** The `YYYY-MM-DD` day of a picked date in the phone's time zone. */
export function localDay(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
