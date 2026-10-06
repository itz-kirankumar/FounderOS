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

export type AvailabilityMember = {
  id: string;
  timezone?: string;
  availabilityStatus?: string;
  workingDays?: number[];
  workdayStart?: string;
  workdayEnd?: string;
};

export function findCommonTimeSlots(
  members: AvailabilityMember[],
  busyIntervals: { start: Date; end: Date }[] = [],
  from = new Date(),
  durationMinutes = 30,
  count = 4,
) {
  if (!members.length) return [] as Date[];
  const weekdays: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const intervals = new Map(
    members.map((member) => [
      member.id,
      new Intl.DateTimeFormat("en-US", {
        timeZone: member.timezone || "UTC",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }),
    ]),
  );
  const candidates: Date[] = [];
  const step = 30 * 60 * 1000;
  const startAt = Math.ceil(from.getTime() / step) * step;
  for (
    let time = startAt;
    time <= startAt + 14 * 24 * 60 * 60 * 1000;
    time += step
  ) {
    const start = new Date(time);
    const end = new Date(time + durationMinutes * 60 * 1000);
    const overlapsMeeting = busyIntervals.some(
      (busy) => start < busy.end && end > busy.start,
    );
    if (overlapsMeeting) continue;
    const worksForEveryone = members.every((member) => {
      if (
        ["Busy", "Away", "Focus time"].includes(member.availabilityStatus || "")
      )
        return false;
      const parts = intervals.get(member.id)!.formatToParts(start);
      const value = (type: string) =>
        parts.find((part) => part.type === type)?.value || "";
      const day = weekdays[value("weekday")];
      const localMinutes = Number(value("hour")) * 60 + Number(value("minute"));
      const [startHour = "9", startMinute = "0"] = (
        member.workdayStart || "09:00"
      ).split(":");
      const [endHour = "17", endMinute = "0"] = (
        member.workdayEnd || "17:00"
      ).split(":");
      const workStart = Number(startHour) * 60 + Number(startMinute);
      const workEnd = Number(endHour) * 60 + Number(endMinute);
      const days = member.workingDays?.length
        ? member.workingDays
        : [1, 2, 3, 4, 5];
      return (
        days.includes(day) &&
        localMinutes >= workStart &&
        localMinutes + durationMinutes <= workEnd
      );
    });
    if (worksForEveryone) candidates.push(start);
    if (candidates.length >= count) break;
  }
  return candidates;
}
