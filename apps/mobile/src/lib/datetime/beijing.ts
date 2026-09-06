// Form dates always use UTC+08:00, independently of the device time zone.
const offsetMs = 8 * 60 * 60 * 1000;
export type BeijingParts = { year: number; month: number; day: number; hour: number; minute: number; second: number; millisecond: number };
export const halfHourOptions = Array.from({ length: 48 }, (_, index) => ({
  hour: Math.floor(index / 2), minute: index % 2 * 30,
  label: `${String(Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}`
}));
export function beijingParts(value: string): BeijingParts | null {
  if (!value) return null;
  const date = new Date(Date.parse(value) + offsetMs);
  if (Number.isNaN(date.getTime())) return null;
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(),
    hour: date.getUTCHours(), minute: date.getUTCMinutes(), second: date.getUTCSeconds(), millisecond: date.getUTCMilliseconds() };
}
export function daysInMonth(year: number, month: number) {
  const date = new Date(0);
  date.setUTCFullYear(year, month, 0);
  return date.getUTCDate();
}
export function beijingIso(parts: BeijingParts) {
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour, parts.minute, parts.second, parts.millisecond);
  return new Date(date.getTime() - offsetMs).toISOString();
}
export function dateLabel(parts: BeijingParts) {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}
export function timeLabel(parts: BeijingParts) {
  const time = `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
  return parts.second || parts.millisecond ? `${time}:${String(parts.second).padStart(2, "0")}${parts.millisecond ? `.${String(parts.millisecond).padStart(3, "0")}` : ""}` : time;
}
