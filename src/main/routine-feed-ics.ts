// The routine feed as an iCalendar file (RFC 5545) that a calendar app subscribes to.
//
// Each run is a single event at a UTC time. The routine calendar already places each run with the
// schedule code that fires it, daylight saving time included, so the file needs no time zone rules
// and a calendar app cannot place a run at a time where OpenBot does not fire it.

import type { RoutineCalendar } from "@openbot/contracts/ipc";

/** A run has no end; the event is long enough for a calendar to show it. */
const EVENT_DURATION = "PT15M";
/** What the feed asks a calendar app to wait between reads. Most apps choose their own interval. */
const REFRESH_INTERVAL = "PT15M";
const MAX_LINE_OCTETS = 75;

export interface RoutineFeedText {
  calendarName: string;
  /** The text under each event of a routine, such as the agent that runs it. */
  description: (routineId: string) => string;
}

export function routineFeedIcs(calendar: RoutineCalendar, text: RoutineFeedText, now: Date): string {
  const names = new Map(calendar.routines.map((routine) => [routine.id, routine.name]));
  const stamp = icsUtc(now);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//OpenBot//Routines//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `NAME:${icsText(text.calendarName)}`,
    `X-WR-CALNAME:${icsText(text.calendarName)}`,
    `REFRESH-INTERVAL;VALUE=DURATION:${REFRESH_INTERVAL}`,
    `X-PUBLISHED-TTL:${REFRESH_INTERVAL}`,
  ];
  for (const run of [...calendar.runs].sort((left, right) => Date.parse(left.at) - Date.parse(right.at))) {
    const name = names.get(run.routineId);
    if (name === undefined) continue;
    const start = icsUtc(new Date(run.at));
    lines.push(
      "BEGIN:VEVENT",
      // The same run keeps its id across reads, so a calendar app moves it rather than adding another.
      `UID:${icsText(`${run.routineId}-${start}@routines.openbot.run`)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${start}`,
      `DURATION:${EVENT_DURATION}`,
      `SUMMARY:${icsText(name)}`,
      `DESCRIPTION:${icsText(text.description(run.routineId))}`,
      // A run does not make the user busy.
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

/** `20261006T090000Z`. */
function icsUtc(date: Date): string {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "");
}

/** A TEXT value: a backslash, semicolon, comma and line break are escaped. */
function icsText(value: string): string {
  return value.replace(/[\\;,]/g, (character) => `\\${character}`).replace(/\r\n|\r|\n/g, "\\n");
}

/** A line longer than 75 octets continues on the next line after a space, never inside a character. */
function foldLine(line: string): string {
  const parts: string[] = [];
  let current = "";
  let octets = 0;
  for (const character of line) {
    const size = Buffer.byteLength(character);
    // A continuation line starts with a space, which counts toward its 75 octets.
    const limit = parts.length === 0 ? MAX_LINE_OCTETS : MAX_LINE_OCTETS - 1;
    if (octets + size > limit) {
      parts.push(current);
      current = "";
      octets = 0;
    }
    current += character;
    octets += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}
