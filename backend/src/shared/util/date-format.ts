/** Parses "yyyyMMdd" (the filter format used throughout the legacy app) into a Date. */
export function parseYyyyMMdd(value: string): Date {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6)) - 1;
  const day = Number(value.slice(6, 8));
  return new Date(year, month, day);
}

/** Formats a Date as "dd/MM/yyyy", matching `DateTimeFormatter.ofPattern("dd/MM/yyyy")`. */
export function formatDdMMyyyy(date: Date): string {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}
