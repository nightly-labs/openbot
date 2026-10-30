import { isDynamicRecord, isString } from "../runtime-values";
import { CHANNEL_ROUTES } from "./channels-v1";
import { withConversationUiBlocks } from "./ui-blocks-v1";
import type { TeamProtocolV2Json } from "./v2";

/**
 * Frozen optional channel-attention-v1 contract: what a client needs to show a channel prompt, notify
 * a channel reply and open the channel from it. It adds, beside the frozen keys of channels-v1:
 *
 * - `threads` on each summary of `GET /v1/channels`: at most 100 `{ agentId, threadId }` records,
 *   the execution thread of each member agent in that channel. A prompt event names a thread, and
 *   this maps it to its channel;
 * - `openTasks` on each summary: the count of its `queued`, `waiting` and `running` tasks. The
 *   released `activeTasks` counts only `running` ones, so it is 0 while a task waits for others. A
 *   client notifies a reply only when this is 0;
 * - `author` on the `lastMessage` of each summary: `{ kind: "member" | "agent" | "coordinator", id }`,
 *   the same identity as the author of a channel message, without the name that `authorName` holds;
 * - `status` on the `lastMessage` of each summary: `"streaming" | "completed" | "failed" |
 *   "interrupted"`, as on the message. A client notifies a reply when it stops streaming;
 * - `uiBlock` on the `message` of each message of `POST /v1/channels/read`, as ui-blocks-v1 sends it
 *   on an agent page, with the same normalization and wire budget.
 *
 * The host adds them only on a request that advertises the capability, so the wire of every released
 * client stays as it was. A host without the capability never sends them, so a client accepts them
 * whenever they are present. A present malformed value fails closed. A `null` author is an author the
 * peer may not see, and it is left out. Widening any of it needs a second capability string.
 */
export const TEAM_CHANNEL_ATTENTION_CAPABILITY = "channel-attention-v1";

const THREAD_LIMIT = 100;
const AUTHOR_KINDS: readonly string[] = ["member", "agent", "coordinator"];
const MESSAGE_STATUSES: readonly string[] = ["streaming", "completed", "failed", "interrupted"];

function identifier(value: unknown, name: string): string {
  if (!isString(value) || !value.length || value.length > 128) throw new Error(`Invalid channel ${name}.`);
  return value;
}

function threads(value: unknown): TeamProtocolV2Json[] {
  if (!Array.isArray(value) || value.length > THREAD_LIMIT) throw new Error("Invalid channel threads.");
  return value.map((item) => {
    if (!isDynamicRecord(item)) throw new Error("Invalid channel thread.");
    return { agentId: identifier(item.agentId, "agent"), threadId: identifier(item.threadId, "thread") };
  });
}

function taskCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid channel open tasks.");
  return value;
}

function author(value: unknown): TeamProtocolV2Json {
  if (!isDynamicRecord(value) || !isString(value.kind) || !AUTHOR_KINDS.includes(value.kind))
    throw new Error("Invalid channel preview author.");
  return { kind: value.kind, id: identifier(value.id, "author") };
}

/** The two channel routes whose responses carry the attention fields. */
export function isChannelAttentionRoute(path: string): boolean {
  const pathname = new URL(path, "http://openbot.invalid").pathname;
  return pathname === CHANNEL_ROUTES.list || pathname === CHANNEL_ROUTES.read;
}

function withSummaryAttention(projected: TeamProtocolV2Json, source: unknown): TeamProtocolV2Json {
  if (!isDynamicRecord(projected) || !isDynamicRecord(source)) return projected;
  const result: { [key: string]: TeamProtocolV2Json } = { ...projected };
  if (source.threads !== undefined) result.threads = threads(source.threads);
  if (source.openTasks !== undefined) result.openTasks = taskCount(source.openTasks);
  const preview = source.lastMessage;
  if (!isDynamicRecord(result.lastMessage) || !isDynamicRecord(preview)) return result;
  const added: { [key: string]: TeamProtocolV2Json } = {};
  if (preview.author != null) added.author = author(preview.author);
  if (preview.status !== undefined) {
    if (!isString(preview.status) || !MESSAGE_STATUSES.includes(preview.status))
      throw new Error("Invalid channel preview status.");
    added.status = preview.status;
  }
  result.lastMessage = { ...result.lastMessage, ...added };
  return result;
}

function withPageUiBlocks(projected: TeamProtocolV2Json, source: unknown): TeamProtocolV2Json {
  if (!isDynamicRecord(projected) || !Array.isArray(projected.messages) || !isDynamicRecord(source)) return projected;
  if (!Array.isArray(source.messages)) return projected;
  // A channel message wraps the conversation message that ui-blocks-v1 knows, so the blocks are
  // added to the inner messages and put back in the same order.
  const projectedInner = (entry: TeamProtocolV2Json): TeamProtocolV2Json =>
    typeof entry === "object" && entry !== null && !Array.isArray(entry) ? (entry.message ?? null) : null;
  const blocks = withConversationUiBlocks(
    { messages: projected.messages.map(projectedInner) },
    { messages: source.messages.map((entry) => (isDynamicRecord(entry) ? entry.message : null)) },
  );
  if (!isDynamicRecord(blocks) || !Array.isArray(blocks.messages)) return projected;
  const messages = blocks.messages;
  return {
    ...projected,
    messages: projected.messages.map((entry, index) =>
      isDynamicRecord(entry) && messages[index] !== undefined ? { ...entry, message: messages[index] } : entry,
    ),
  };
}

/** `projected` with the attention fields of `source` that the channels-v1 codec dropped. */
export function withChannelAttention(path: string, projected: TeamProtocolV2Json, source: unknown): TeamProtocolV2Json {
  const pathname = new URL(path, "http://openbot.invalid").pathname;
  if (pathname === CHANNEL_ROUTES.read) return withPageUiBlocks(projected, source);
  if (pathname !== CHANNEL_ROUTES.list || !Array.isArray(projected) || !Array.isArray(source)) return projected;
  return projected.map((summary, index) => withSummaryAttention(summary, source[index]));
}
