import { addDays, format, parseISO } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export function detectBrowserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function toUtcInstant(localDateTime: string, timezone: string) {
  const date = fromZonedTime(localDateTime, timezone);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Enter a valid date and time.");
  }
  return date;
}

export function dateKeyInTimezone(instant: Date, timezone: string) {
  return formatInTimeZone(instant, timezone, "yyyy-MM-dd");
}

export function formatInstantInTimezone(instant: Date, timezone: string) {
  return formatInTimeZone(instant, timezone, "MMM d, yyyy · h:mm a");
}

export function formatDateInTimezone(instant: Date, timezone: string) {
  return formatInTimeZone(instant, timezone, "EEEE, MMMM d");
}

export function previousSevenDayKeys(timezone: string) {
  const today = parseISO(dateKeyInTimezone(new Date(), timezone));
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(today, index - 6);
    return { key: format(date, "yyyy-MM-dd"), label: format(date, "EEEEE") };
  });
}

export function tomorrowAtSixInTimezone(timezone: string) {
  const today = dateKeyInTimezone(new Date(), timezone);
  const tomorrow = format(addDays(parseISO(today), 1), "yyyy-MM-dd");
  return toUtcInstant(`${tomorrow}T18:00`, timezone);
}
