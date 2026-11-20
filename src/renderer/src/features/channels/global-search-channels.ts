import type { ChannelSummary } from "@openbot/contracts/ipc";
import type { GlobalSearchChannel } from "@openbot/ui/components/GlobalSearch";
import { coordinatorText } from "@openbot/ui/features/channels/coordinator-text";

export function globalSearchChannels(
  channels: ChannelSummary[],
  localize: (text: string) => string,
): GlobalSearchChannel[] {
  return channels
    .filter((channel) => !channel.archived)
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      detail: channel.lastMessage
        ? `${channel.lastMessage.authorName}: ${coordinatorText(channel.lastMessage.author, channel.lastMessage.text, localize)}`
        : undefined,
    }));
}
