import type { DeviceToolOperation, DeviceToolRequest } from "@openbot/contracts/team-protocol/device-tools-v1";
import {
  loadDeviceAppsPreference,
  saveDeviceAppAccess,
  saveDeviceAppWriteAlways,
  useDeviceAppsPreference,
  type WritableDeviceApp,
} from "@/features/settings/model/device-apps";
import { askDeviceAppConsent } from "./consent";
import { DeviceToolError } from "./device-tool-error";

const WRITE_OPERATIONS: readonly DeviceToolOperation[] = ["calendar.add_event", "reminders.add"];

/** The app of an operation that adds data, or null for a read. */
function addedTo(request: DeviceToolRequest): WritableDeviceApp | null {
  if (!WRITE_OPERATIONS.includes(request.operation)) return null;
  return request.app === "calendar" || request.app === "reminders" ? request.app : null;
}

/** A failed save still applies for this request. Settings shows the choice as it is in memory. */
function keep(save: Promise<void>): void {
  void save.catch(() => undefined);
}

/**
 * Decides in the app, before the iPhone asks for its own permission. A read asks until the user
 * chooses Always for the app. An add asks every time until the user chooses Always for adding.
 * Deny from a prompt saves a refusal for reads only; for an add it refuses this request.
 */
export async function authorizeDeviceTool(request: DeviceToolRequest, requestId: string): Promise<void> {
  await loadDeviceAppsPreference();
  const { access, writeAlways } = useDeviceAppsPreference.getState();
  const mode = access[request.app];
  if (mode === "deny") throw new DeviceToolError("app_not_allowed");
  const adds = addedTo(request);
  if (adds ? writeAlways[adds] : mode === "allow") return;

  const choice = await askDeviceAppConsent({
    requestId,
    app: request.app,
    operation: request.operation,
    ...("title" in request.args ? { title: request.args.title } : {}),
  });
  if (choice === "once") return;
  if (choice === "always") {
    keep(adds ? saveDeviceAppWriteAlways(adds, true) : saveDeviceAppAccess(request.app, "allow"));
    return;
  }
  if (choice === "deny" && !adds) keep(saveDeviceAppAccess(request.app, "deny"));
  throw new DeviceToolError("app_not_allowed");
}
