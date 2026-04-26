/** ISO datetime with timezone offset, e.g. 2026-04-26T15:42:00+09:00 */
export function isoDateTimeWithTz(date: Date = new Date()): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const tz = -date.getTimezoneOffset();
  const sign = tz >= 0 ? '+' : '-';
  const abs = Math.abs(tz);
  const tzStr = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${tzStr}`
  );
}

/** ISO date only, e.g. 2026-04-26 */
export function isoDate(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
