import { isDynamicRecord, isString } from "../runtime-values";
import { CHANNEL_ROUTES } from "./channels-v1";
import { withConversationUiBlocks } from "./ui-blocks-v1";
import type { TeamProtocolV2Json } from "./webrtc-framing";

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

export function withChannelAttention(path: string, projected: TeamProtocolV2Json, source: unknown): TeamProtocolV2Json {
  const pathname = new URL(path, "http://openbot.invalid").pathname;
  if (pathname === CHANNEL_ROUTES.read) return withPageUiBlocks(projected, source);
  if (pathname !== CHANNEL_ROUTES.list || !Array.isArray(projected) || !Array.isArray(source)) return projected;
  return projected.map((summary, index) => withSummaryAttention(summary, source[index]));
}
