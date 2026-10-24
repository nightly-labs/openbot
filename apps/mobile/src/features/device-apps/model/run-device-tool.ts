import {
  type DeviceToolRequest,
  type DeviceToolRespondRequest,
  type DeviceToolResults,
  decodeDeviceToolResult,
} from "@openbot/contracts/team-protocol/device-tools-v1";
import { AppState } from "react-native";
import { supportLog } from "@/features/support/model/support-log";
import { authorizeDeviceTool } from "./authorize";
import { addCalendarEvent, listCalendarEvents } from "./calendar";
import { findContacts } from "./contacts";
import { DeviceToolError } from "./device-tool-error";
import { currentLocation } from "./location";
import { ensureOsPermission } from "./os-permissions";
import { addReminder, listReminders } from "./reminders";

function execute(request: DeviceToolRequest): Promise<DeviceToolResults[keyof DeviceToolResults]> {
  switch (request.operation) {
    case "calendar.list_events":
      return listCalendarEvents(request.args);
    case "calendar.add_event":
      return addCalendarEvent(request.args);
    case "reminders.list":
      return listReminders(request.args);
    case "reminders.add":
      return addReminder(request.args);
    case "contacts.find":
      return findContacts(request.args);
    case "location.current":
      return currentLocation();
  }
}

/**
 * Runs one request of the host on this phone and returns the answer to send. The answer is a result
 * or one of four codes; it never carries an error text. The log keeps the app, the operation, the code
 * and the time, and never the arguments or the result.
 */
export async function runDeviceTool(request: DeviceToolRequest, requestId: string): Promise<DeviceToolRespondRequest> {
  const started = Date.now();
  let answer: DeviceToolRespondRequest;
  try {
    // The sheet and the iPhone prompt need the app on screen.
    if (AppState.currentState !== "active") throw new DeviceToolError("device_error");
    await authorizeDeviceTool(request, requestId);
    await ensureOsPermission(request.app);
    const result = await execute(request);
    // The phone checks its own answer against the contract, so the host never gets a shape it refuses.
    answer = { requestId, ok: true, result: decodeDeviceToolResult(request.operation, result) };
  } catch (error) {
    answer = { requestId, ok: false, code: error instanceof DeviceToolError ? error.code : "device_error" };
  }
  supportLog.add(
    "info",
    "app",
    `device tool ${request.app} ${request.operation} ${answer.ok ? "ok" : answer.code} (${Date.now() - started} ms)`,
  );
  return answer;
}
