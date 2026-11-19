import type { ChannelSummary } from "@openbot/contracts/ipc";
import type { GlobalSearchChannel } from "@openbot/ui/components/GlobalSearch";

export function globalSearchChannels(channels: ChannelSummary[]): GlobalSearchChannel[] {
  return channels
    .filter((channel) => !channel.archived)
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      detail: channel.lastMessage ? `${channel.lastMessage.authorName}: ${channel.lastMessage.text}` : undefined,
    }));
}
