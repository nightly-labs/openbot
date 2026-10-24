import type { DeviceToolArgs, DeviceToolResults } from "@openbot/contracts/team-protocol/device-tools-v1";
import * as Calendar from "expo-calendar";
import { DeviceToolError } from "./device-tool-error";
import { clip, deviceIso, parseDeviceDate, requireText } from "./device-values";

export async function listReminders(
  args: DeviceToolArgs["reminders.list"],
): Promise<DeviceToolResults["reminders.list"]> {
  const calendars = await Calendar.getCalendars(Calendar.EntityTypes.REMINDER);
  const status = args.status === "done" ? Calendar.ReminderStatus.COMPLETED : Calendar.ReminderStatus.INCOMPLETE;
  const lists = await Promise.all(calendars.map((calendar) => calendar.listReminders(null, null, status)));
  const reminders = lists
    .flat()
    .filter((reminder) => reminder.id !== undefined && reminder.id.length > 0 && reminder.id.length <= 256);
  // Reminders with a due date come first, the earliest first.
  const due = (value: string | Date | undefined) => (value ? new Date(value).getTime() : Number.POSITIVE_INFINITY);
  return {
    reminders: reminders
      .sort((a, b) => due(a.dueDate) - due(b.dueDate))
      .slice(0, args.limit)
      .map((reminder) => ({
        id: reminder.id ?? "",
        title: clip(reminder.title, 200),
        ...(reminder.dueDate ? { due: deviceIso(reminder.dueDate) } : {}),
        done: reminder.completed === true,
      })),
  };
}

export async function addReminder(args: DeviceToolArgs["reminders.add"]): Promise<DeviceToolResults["reminders.add"]> {
  requireText(args.title);
  const due = args.due === undefined ? undefined : parseDeviceDate(args.due);
  const calendars = await Calendar.getCalendars(Calendar.EntityTypes.REMINDER);
  const list = calendars.find((calendar) => calendar.allowsModifications);
  if (!list) throw new DeviceToolError("device_error");
  const reminder = await list.createReminder({
    title: args.title,
    ...(due ? { dueDate: due } : {}),
    ...(args.notes ? { notes: args.notes } : {}),
  });
  if (!reminder.id) throw new DeviceToolError("device_error");
  return { id: reminder.id };
}
