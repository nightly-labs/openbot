import { isDynamicRecord, isString } from "../runtime-values";
import { CHANNEL_ROUTES } from "./channels-v1";
import type { TeamProtocolV2Json } from "./v2";

/**
 * Frozen optional channel-seen-subtasks-v1 contract: which sub-tasks a waiting channel task has already
 * read (#7505). A lead that assigns work in rounds keeps every sub-task in `dependencies`, so without
 * this a client listed the sub-tasks of each earlier round as replies that still wait to be read.
 * It adds, beside the frozen keys of channels-v1:
 *
 * - `seenDependencies` on a task of `POST /v1/channels/read` in state `waiting`: at most 100 unique
 *   ids of its `dependencies` whose results one of its earlier turns already had.
 *
 * The host adds it only on a request that advertises the capability, so the wire of every released
 * client stays as it was. A host without the capability never sends it, so a client accepts it
 * whenever it is present. A present malformed value fails closed. Widening any of it needs a second
 * capability string.
 */
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

/** `projected` with the `seenDependencies` of each task of `source`, which channels-v1 dropped. */
export function withChannelSeenSubtasks(
  path: string,
  projected: TeamProtocolV2Json,
  source: unknown,
): TeamProtocolV2Json {
  if (new URL(path, "http://openbot.invalid").pathname !== CHANNEL_ROUTES.read) return projected;
  if (!isDynamicRecord(projected) || !Array.isArray(projected.tasks) || !isDynamicRecord(source)) return projected;
  const tasks = source.tasks;
  if (!Array.isArray(tasks)) return projected;
  // The channels-v1 codec keeps the order of the tasks, so each projected task has its source at its index.
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
