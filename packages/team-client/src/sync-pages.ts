import type {
  ChannelMessage,
  ChannelPage,
  ConversationMessage,
  ConversationPage,
  ConversationPageInfo,
} from "@openbot/contracts/ipc";
import type { ChannelPageMeta, ConversationPageMeta } from "@openbot/contracts/team-protocol/sync-logs";

export interface ConversationSyncWindow {
  readonly olderCursor: string | null;
  readonly newerCount?: number;
}

export function conversationPageFromSync(
  rows: readonly ConversationMessage[],
  meta: ConversationPageMeta,
  references: ReadonlyMap<string, ConversationMessage>,
  window: ConversationSyncWindow,
): ConversationPage | null {
  const messages = [...rows];
  const olderCount = meta.messageCount - messages.length - (window.newerCount ?? 0);
  const hasOlder = olderCount > 0;
  if (olderCount < 0 || hasOlder !== (window.olderCursor !== null)) return null;
  const pageInfo: ConversationPageInfo = {
    hasOlder,
    olderCursor: hasOlder ? window.olderCursor : null,
    ...(meta.historyExtent && hasOlder ? { olderCount } : {}),
    ...(meta.historyExtent && messages.length > 0 && meta.oldestAt !== null ? { oldestAt: meta.oldestAt } : {}),
  };
  return {
    agentId: meta.agentId,
    threadId: meta.threadId,
    activeTurnId: meta.activeTurnId,
    revision: meta.revision,
    messages,
    references: replyReferences(messages, references),
    pageInfo,
    ...(meta.readState === undefined ? {} : { readState: meta.readState }),
  };
}

function replyReferences(
  messages: readonly ConversationMessage[],
  references: ReadonlyMap<string, ConversationMessage>,
): Record<string, ConversationMessage> {
  const shown = new Set(messages.map((message) => message.id));
  const found: Record<string, ConversationMessage> = {};
  for (const message of messages) {
    const target = message.replyToMessageId;
    if (!target || shown.has(target)) continue;
    const reference = references.get(target);
    if (reference) found[target] = reference;
  }
  return found;
}

export function channelPageFromSync(
  rows: readonly ChannelMessage[],
  meta: ChannelPageMeta,
  window: { readonly olderCursor: string | null },
): ChannelPage | null {
  const start = meta.olderCursor;
  const logStart = window.olderCursor === null ? null : Number(window.olderCursor);
  if (start === null ? logStart !== null : logStart !== null && logStart > start) return null;
  if (rows.some((item) => item.sequence > meta.throughSequence)) return null;
  const messages = start === null ? [...rows] : rows.filter((item) => item.sequence >= start);
  return { ...meta, messages };
}
