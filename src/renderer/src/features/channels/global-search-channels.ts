import type { ChannelSummary } from "@openbot/contracts/ipc";
import type { GlobalSearchChannel } from "@openbot/ui/components/GlobalSearch";

/**
 * The channels that global search lists, with the last message as the detail. The desktop app and
 * the web client share it, so this module imports no desktop context.
 */
export function globalSearchChannels(channels: ChannelSummary[]): GlobalSearchChannel[] {
  return channels
    .filter((channel) => !channel.archived)
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      detail: channel.lastMessage ? `${channel.lastMessage.authorName}: ${channel.lastMessage.text}` : undefined,
    }));
}
