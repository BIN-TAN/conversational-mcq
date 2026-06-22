import { getServerEnv } from "@/lib/env";

type LocalDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

const localDateTimePattern =
  /^(\d{4})-(\d{2})-(\d{2})(?:T| )(\d{2}):(\d{2})$/;

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function getCourseTimezone() {
  return getServerEnv().COURSE_TIMEZONE;
}

function zonedParts(date: Date, timeZone: string): LocalDateTimeParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute
  };
}

function partsEqual(a: LocalDateTimeParts, b: LocalDateTimeParts) {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute
  );
}

function offsetMsForTimeZone(date: Date, timeZone: string) {
  const parts = zonedParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);

  return asUtc - date.getTime();
}

export function formatCourseDateTime(date: Date | null | undefined) {
  if (!date) {
    return null;
  }

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: getCourseTimezone(),
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(date);
}

export function toCourseDateTimeInputValue(date: Date | null | undefined) {
  if (!date) {
    return "";
  }

  const parts = zonedParts(date, getCourseTimezone());

  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function parseCourseDateTimeInput(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error("Expected a local date-time string.");
  }

  const match = value.trim().match(localDateTimePattern);

  if (!match) {
    throw new Error("Use YYYY-MM-DDTHH:mm in the configured course timezone.");
  }

  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5])
  };

  if (
    parts.month < 1 ||
    parts.month > 12 ||
    parts.day < 1 ||
    parts.day > 31 ||
    parts.hour > 23 ||
    parts.minute > 59
  ) {
    throw new Error("The local date-time is outside the supported calendar range.");
  }

  const timeZone = getCourseTimezone();
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute
  );
  let candidate = new Date(localAsUtc - offsetMsForTimeZone(new Date(localAsUtc), timeZone));
  candidate = new Date(localAsUtc - offsetMsForTimeZone(candidate, timeZone));

  if (!partsEqual(zonedParts(candidate, timeZone), parts)) {
    throw new Error("The local date-time is invalid in the configured course timezone.");
  }

  const matchingCandidates = new Set<number>();

  for (const deltaMinutes of [-120, -60, 0, 60, 120]) {
    const possible = new Date(candidate.getTime() + deltaMinutes * 60_000);

    if (partsEqual(zonedParts(possible, timeZone), parts)) {
      matchingCandidates.add(possible.getTime());
    }
  }

  if (matchingCandidates.size > 1) {
    throw new Error("The local date-time is ambiguous in the configured course timezone.");
  }

  return candidate;
}
