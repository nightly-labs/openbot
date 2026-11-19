import { isDynamicRecord, isString } from "../runtime-values";
import { CHANNEL_ROUTES } from "./channels-v1";
import type { TeamProtocolV2Json } from "./webrtc-framing";

export const CHANNEL_SEEN_SUBTASKS_CAPABILITY = "channel-seen-subtasks-v1";

const ID_LIMIT = 100;
const IDENTIFIER_LIMIT = 128;

function seenDependencies(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > ID_LIMIT ||
    !value.every((id) => isString(id) && id.length > 0 && id.length <= IDENTIFIER_LIMIT) ||
    new Set(value).size !== value.length
  )
    throw new Error("Invalid channel seen dependencies.");
  return value;
}

export function withChannelSeenSubtasks(
  path: string,
  projected: TeamProtocolV2Json,
  source: unknown,
): TeamProtocolV2Json {
  if (new URL(path, "http://openbot.invalid").pathname !== CHANNEL_ROUTES.read) return projected;
  if (!isDynamicRecord(projected) || !Array.isArray(projected.tasks) || !isDynamicRecord(source)) return projected;
  const tasks = source.tasks;
  if (!Array.isArray(tasks)) return projected;
  return {
    ...projected,
    tasks: projected.tasks.map((task, index) => {
      const original = tasks[index];
      const seen = isDynamicRecord(original) ? original.seenDependencies : undefined;
      if (seen === undefined || !isDynamicRecord(task)) return task;
      const ids = seenDependencies(seen);
      const dependencies = Array.isArray(task.dependencies) ? task.dependencies : [];
      if (task.state !== "waiting" || !ids.every((id) => dependencies.includes(id)))
        throw new Error("Invalid channel seen dependencies.");
      return { ...task, seenDependencies: ids };
    }),
  };
}
