// What main forwards from an agent service, local or remote, with the server it came from.

import { isAgentEvent, type ScopedAgentEvent } from "@openbot/contracts/ipc";
import { decodeRecord, requiredString } from "@openbot/contracts/ipc-decoding";
import { isBoolean } from "@openbot/contracts/runtime-values";

export function decodeScopedAgentEvent(value: unknown): ScopedAgentEvent {
  const scoped = decodeRecord(value, "agent event");
  const serverId = requiredString(scoped, "serverId");
  const { event, bufferedLive } = scoped;
  if (!isAgentEvent(event)) throw new Error("Invalid agent event.");
  if (bufferedLive === undefined) return { serverId, event };
  if (!isBoolean(bufferedLive)) throw new Error("Invalid agent event.");
  return { serverId, event, bufferedLive };
}
