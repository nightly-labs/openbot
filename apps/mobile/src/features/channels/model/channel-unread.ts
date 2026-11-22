import {
  CHANNEL_ROUTING_EVENT_ITEM_TYPE_PREFIX,
  type ChannelMessage,
  SETTING_LINK_ITEM_TYPE_PREFIX,
} from "@openbot/contracts/ipc";

const NOT_COUNTED_ITEM_TYPES: ReadonlySet<string> = new Set([
  "plan",
  "subagents",
  "channel-change",
  "context-reset",
  "commentary",
]);

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
      itemType.startsWith(CHANNEL_ROUTING_EVENT_ITEM_TYPE_PREFIX) ||
      itemType.startsWith(SETTING_LINK_ITEM_TYPE_PREFIX)
    )
      continue;
    remaining -= 1;
    if (remaining === 0) return entry.id;
  }
  return entries[0]?.id ?? null;
}
