import type { DeviceToolApp } from "@openbot/contracts/team-protocol/device-tools-v1";
import * as Calendar from "expo-calendar";
import * as Contacts from "expo-contacts";
import * as Location from "expo-location";
import { DeviceToolError } from "./device-tool-error";

interface OsPermission {
  granted: boolean;
  canAskAgain: boolean;
}

export type OsPermissionState = "granted" | "denied" | "undetermined";

const PERMISSIONS: Record<DeviceToolApp, { read: () => Promise<OsPermission>; request: () => Promise<OsPermission> }> =
  {
    calendar: {
      read: () => Calendar.getCalendarPermissions(),
      request: () => Calendar.requestCalendarPermissions(),
    },
    reminders: {
      read: () => Calendar.getRemindersPermissions(),
      request: () => Calendar.requestRemindersPermissions(),
    },
    contacts: {
      read: () => Contacts.getPermissionsAsync(),
      request: () => Contacts.requestPermissionsAsync(),
    },
    location: {
      read: () => Location.getForegroundPermissionsAsync(),
      request: () => Location.requestForegroundPermissionsAsync(),
    },
  };

/** The iPhone permission of an app, for Settings. A failed read counts as undetermined. */
export async function readOsPermission(app: DeviceToolApp): Promise<OsPermissionState> {
  try {
    const permission = await PERMISSIONS[app].read();
    return permission.granted ? "granted" : permission.canAskAgain ? "undetermined" : "denied";
  } catch {
    return "undetermined";
  }
}

/**
 * The iPhone permission prompt, shown only here: when the user turns an app on in Settings, and at
 * the first agent use, after the user allowed the request in OpenBot. A permission the user refused earlier cannot be asked again; it is `os_permission_denied`.
 */
export async function ensureOsPermission(app: DeviceToolApp): Promise<void> {
  const { read, request } = PERMISSIONS[app];
  const current = await read();
  if (current.granted) return;
  if (!current.canAskAgain) throw new DeviceToolError("os_permission_denied");
  if (!(await request()).granted) throw new DeviceToolError("os_permission_denied");
}
