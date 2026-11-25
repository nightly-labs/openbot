import { isDynamicRecord, isString } from "../runtime-values";
import { CHANNEL_ROUTES } from "./channels-v1";
import type { TeamProtocolV2Json } from "./webrtc-framing";

export const CHANNEL_TASK_WAITS_CAPABILITY = "channel-task-waits-v1";

const IDENTIFIER_LIMIT = 128;
const CHANNEL_NAME_LIMIT = 80;

function identifier(value: unknown): value is string {
  return isString(value) && value.length > 0 && value.length <= IDENTIFIER_LIMIT;
}

function invalid(): never {
  throw new Error("Invalid channel task waits.");
}

export function withChannelTaskWaits(path: string, projected: TeamProtocolV2Json, source: unknown): TeamProtocolV2Json {
  if (new URL(path, "http://openbot.invalid").pathname !== CHANNEL_ROUTES.read) return projected;
  if (!isDynamicRecord(projected) || !isDynamicRecord(source) || source.waits === undefined) return projected;
  const tasks = Array.isArray(projected.tasks)
    ? projected.tasks.flatMap((task) => (isDynamicRecord(task) ? [task] : []))
    : [];
  const waits = source.waits;
  if (!Array.isArray(waits) || waits.length > tasks.length) invalid();
  const seen = new Set<string>();
  return {
    ...projected,
    waits: waits.map((wait): TeamProtocolV2Json => {
      if (!isDynamicRecord(wait) || !identifier(wait.taskId) || !identifier(wait.agentId) || seen.has(wait.taskId))
        invalid();
      seen.add(wait.taskId);
      const task = tasks.find((item) => item.id === wait.taskId);
      if (task?.state !== "queued" || task.ownerAgentId !== wait.agentId) invalid();
      if (wait.reason === "channel-full") return { taskId: wait.taskId, agentId: wait.agentId, reason: "channel-full" };
      if (
        wait.reason !== "agent-busy" ||
        !identifier(wait.channelId) ||
        !isString(wait.channelName) ||
        wait.channelName.length === 0 ||
        wait.channelName.length > CHANNEL_NAME_LIMIT
      )
        invalid();
      return {
        taskId: wait.taskId,
        agentId: wait.agentId,
        reason: "agent-busy",
        channelId: wait.channelId,
        channelName: wait.channelName,
      };
    }),
  };
}
