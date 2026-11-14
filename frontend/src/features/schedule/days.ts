import { format, parseISO } from "date-fns";

/**
 * The Schedule page's calendar arithmetic (`FRONTEND-044`). A day is its
 * `YYYY-MM-DD` string, the form of the address's `?date=` and of the first ten
 * characters of every game's stored `date`, so a game's day is read off its
 * timestamp and never converted. Arithmetic runs on UTC midnights, where no
 * day is ever 23 or 25 hours long.
 */

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const DAY_MS = 86_400_000;

/** The time zone game dates are stored in. */
const EASTERN = "America/New_York";

function utc(day: string): Date {
  const [, year, month, date] = ISO_DAY.exec(day) ?? [];
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(date)));
}

function isoOf(moment: Date): string {
  return moment.toISOString().slice(0, 10);
}

/** `value` when it is a real `YYYY-MM-DD` day, otherwise `null`. */
export function parseDay(value: string | null): string | null {
  if (value === null) return null;
  const match = ISO_DAY.exec(value);
  if (match === null) return null;
  const moment = utc(value);
  return Number.isNaN(moment.getTime()) || isoOf(moment) !== value
    ? null
    : value;
}

/** Today in US Eastern time, whatever the viewer's own zone. */
export function easternToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) =>
    parts.find((each) => each.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function addDays(day: string, count: number): string {
  return isoOf(new Date(utc(day).getTime() + count * DAY_MS));
}

/** "Sat 7 Nov". */
export function shortDay(day: string): string {
  const moment = utc(day);
  return `${WEEKDAYS[moment.getUTCDay()]} ${moment.getUTCDate()} ${MONTHS[moment.getUTCMonth()]}`;
}

/** "Today", "Yesterday", "Tomorrow", otherwise "Sat 7 Nov". */
export function dayLabel(day: string, today: string): string {
  if (day === today) return "Today";
  if (day === addDays(today, -1)) return "Yesterday";
  if (day === addDays(today, 1)) return "Tomorrow";
  return shortDay(day);
}

/** The season a day belongs to: from 1 August, the one starting that year. */
export function seasonOf(day: string): string {
  const moment = utc(day);
  const start =
    moment.getUTCMonth() >= 7
      ? moment.getUTCFullYear()
      : moment.getUTCFullYear() - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** The stored game's day: its timestamp's date, as stored (US Eastern). */
export function dayOfGame(date: string): string {
  return date.slice(0, 10);
}

/**
 * The start time in Eastern, "7:30 PM ET". The stored timestamp is naive
 * US-Eastern, and `parseISO` reads it as wall-clock time, so it is shown as
 * stored in every viewer's zone.
 */
export function easternStartTime(date: string): string {
  const parsed = parseISO(date);
  return Number.isNaN(parsed.getTime())
    ? "Time TBD"
    : `${format(parsed, "h:mm a")} ET`;
}
