import { CHANNEL_ROUTING_EVENT_ITEM_TYPE_PREFIX, type ChannelMessage } from "@openbot/contracts/ipc";

/** Item types that the host leaves out of a channel's unread count (`src/backend/channel-store.ts`). */
const NOT_COUNTED_ITEM_TYPES: ReadonlySet<string> = new Set([
  "plan",
  "subagents",
  "channel-change",
  "context-reset",
  "commentary",
]);

/**
 * The first unread message of a channel page, where the NEW line stands, or `null` when the reader
 * has seen everything. A channel summary has an unread count and no read mark, so the walk goes back
 * from the newest message over the messages that the host counts, as the desktop does. A count that
 * is larger than the page puts the line on the first message of the page.
 */
export function firstUnreadChannelMessageId(
  entries: readonly ChannelMessage[],
  unreadCount: number,
  memberId: string | null,
): string | null {
  if (unreadCount <= 0) return null;
  let remaining = unreadCount;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry) continue;
    const itemType = entry.message.itemType ?? "";
    if (
      entry.author.id === memberId ||
      NOT_COUNTED_ITEM_TYPES.has(itemType) ||
      itemType.startsWith(CHANNEL_ROUTING_EVENT_ITEM_TYPE_PREFIX)
    )
      continue;
    remaining -= 1;
    if (remaining === 0) return entry.id;
  }
  return entries[0]?.id ?? null;
}
