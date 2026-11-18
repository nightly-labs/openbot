import { isDynamicRecord, isString } from "../runtime-values";
import { CHANNEL_ROUTES } from "./channels-v1";
import type { TeamProtocolV2Json } from "./v2";

/**
 * Frozen optional channel-task-waits-v1 contract: why a queued channel task does not start (#6067).
 * The scheduler skips such a task and keeps no reason, so a client showed a request that did not
 * start and nothing more. It adds, beside the frozen keys of channels-v1:
 *
 * - `waits` on the first page of `POST /v1/channels/read`: at most one entry for each task of the
 *   page, each for a task in state `queued`, with `taskId`, `agentId` (the owner of the task) and
 *   `reason`. `reason` is `"agent-busy"`, with `channelId` and `channelName` (1 to 80 characters)
 *   of the channel where the agent works, or `"channel-full"`.
 *
 * The host adds it only on a request that advertises the capability, so the wire of every released
 * client stays as it was. A host without the capability never sends it, so a client accepts it
 * whenever it is present. A present malformed value fails closed. A new reason or key needs a second
 * capability string.
 */
export const CHANNEL_TASK_WAITS_CAPABILITY = "channel-task-waits-v1";

const IDENTIFIER_LIMIT = 128;
const CHANNEL_NAME_LIMIT = 80;

function identifier(value: unknown): value is string {
  return isString(value) && value.length > 0 && value.length <= IDENTIFIER_LIMIT;
}

function invalid(): never {
  throw new Error("Invalid channel task waits.");
}

/** `projected` with the `waits` of `source`, which channels-v1 dropped. */
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
