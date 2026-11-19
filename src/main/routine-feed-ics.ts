import type { RoutineCalendar } from "@openbot/contracts/ipc";

const EVENT_DURATION = "PT15M";
const REFRESH_INTERVAL = "PT15M";
const MAX_LINE_OCTETS = 75;

export interface RoutineFeedText {
  calendarName: string;
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
      `UID:${icsText(`${run.routineId}-${start}@routines.openbot.run`)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${start}`,
      `DURATION:${EVENT_DURATION}`,
      `SUMMARY:${icsText(name)}`,
      `DESCRIPTION:${icsText(text.description(run.routineId))}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

function icsUtc(date: Date): string {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "");
}

function icsText(value: string): string {
  return value.replace(/[\\;,]/g, (character) => `\\${character}`).replace(/\r\n|\r|\n/g, "\\n");
}

function foldLine(line: string): string {
  const parts: string[] = [];
  let current = "";
  let octets = 0;
  for (const character of line) {
    const size = Buffer.byteLength(character);
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
