import type { AgentEvent, TeamRealtimeEvent } from "@openbot/contracts/ipc";
import { DEVICE_TOOLS_ROUTES } from "@openbot/contracts/team-protocol/device-tools-v1";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { cancelDeviceAppConsent } from "./consent";
import { runDeviceTool } from "./run-device-tool";

type DeviceToolPost = (serverId: string, path: string, body: TeamProtocolV2Json) => Promise<unknown>;

/** The requests that this phone is working on, so a repeated event does not ask the user twice. */
const running = new Set<string>();

/**
 * Handles the two device tool events of a host on the native side. Returns true for such an event.
 * The answer is one POST; a late answer gets a 409 from the host, which is not an error here.
 */
export function handleDeviceToolEvent(
  serverId: string,
  event: AgentEvent | TeamRealtimeEvent,
  post: DeviceToolPost,
): boolean {
  if (event.type === "device-tool-resolved") {
    cancelDeviceAppConsent(event.requestId);
    return true;
  }
  if (event.type !== "device-tool-requested") return false;
  const key = `${serverId}:${event.requestId}`;
  if (running.has(key)) return true;
  running.add(key);
  void runDeviceTool(event, event.requestId)
    .then((answer) => post(serverId, DEVICE_TOOLS_ROUTES.respond, answer))
    .catch(() => undefined)
    .finally(() => running.delete(key));
  return true;
}
