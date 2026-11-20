import type { ChannelSummary } from "@openbot/contracts/ipc";
import type { GlobalSearchChannel } from "@openbot/ui/components/GlobalSearch";

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
        ? `${channel.lastMessage.authorName}: ${channelPreviewText(channel.lastMessage, localize)}`
        : undefined,
    }));
}

function channelPreviewText(message: NonNullable<ChannelSummary["lastMessage"]>, localize: (text: string) => string) {
  return message.author?.kind === "coordinator" ? localize(message.text) : message.text;
}
