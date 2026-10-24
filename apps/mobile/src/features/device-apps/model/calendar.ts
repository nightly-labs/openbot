import type { DeviceToolArgs, DeviceToolResults } from "@openbot/contracts/team-protocol/device-tools-v1";
import * as Calendar from "expo-calendar";
import { DeviceToolError } from "./device-tool-error";
import { clip, deviceIso, MAX_EVENT_SPAN_MS, parseDeviceDate, requireText } from "./device-values";

export async function listCalendarEvents(
  args: DeviceToolArgs["calendar.list_events"],
): Promise<DeviceToolResults["calendar.list_events"]> {
  const from = parseDeviceDate(args.from);
  const to = parseDeviceDate(args.to);
  if (to.getTime() < from.getTime() || to.getTime() - from.getTime() > MAX_EVENT_SPAN_MS) {
    throw new DeviceToolError("invalid_arguments");
  }
  const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
  const names = new Map(calendars.map((calendar) => [calendar.id, calendar.title]));
  const events = await Calendar.listEvents(calendars, from, to);
  return {
    events: events
      .filter((event) => event.id.length > 0 && event.id.length <= 256)
      .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
      .slice(0, args.limit)
      .map((event) => ({
        id: event.id,
        title: clip(event.title, 200),
        start: deviceIso(event.startDate),
        end: deviceIso(event.endDate),
        allDay: event.allDay,
        ...(event.location ? { location: clip(event.location, 200) } : {}),
        calendar: clip(names.get(event.calendarId), 200),
      })),
  };
}

export async function addCalendarEvent(
  args: DeviceToolArgs["calendar.add_event"],
): Promise<DeviceToolResults["calendar.add_event"]> {
  requireText(args.title);
  const start = parseDeviceDate(args.start);
  const end = parseDeviceDate(args.end);
  if (end.getTime() < start.getTime()) throw new DeviceToolError("invalid_arguments");
  const calendar = Calendar.getDefaultCalendarSync();
  if (!calendar.allowsModifications) throw new DeviceToolError("device_error");
  const event = await calendar.createEvent({
    title: args.title,
    startDate: start,
    endDate: end,
    allDay: args.allDay ?? false,
    ...(args.location ? { location: args.location } : {}),
    ...(args.notes ? { notes: args.notes } : {}),
  });
  return { id: event.id };
}
