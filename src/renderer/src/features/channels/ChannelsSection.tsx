import type { ChannelSummary } from "@openbot/contracts/ipc";
import { For, Show } from "solid-js";
import { Badge, Button } from "../../components/ui";
import { sidebarMessageTime } from "../sidebar/sidebar-filtering";
import { ChannelAvatar } from "./ChannelAvatar";
import { useChannels } from "./channels-context";

/**
 * Channel rows use the same anatomy as agent and person rows - avatar, name, time, one preview
 * line - so the sidebar reads as one list. Running work is a prefix on the preview line rather
 * than a word beside the name, which is what kept the row from fitting the shared 54px height.
 */
export function ChannelsSection() {
  const channels = useChannels();
  const visible = () => channels.state.channels.filter((channel) => channel.archived === channels.state.archived);
  const preview = (channel: ChannelSummary) => {
    const text = channel.lastMessage?.text ?? "No messages yet";
    return channel.activeTasks > 0 ? `Working · ${text}` : text;
  };
  return (
    <Show when={channels.supported() && visible().length}>
      <div class="channel-navigation">
        <For each={visible()}>
          {(channel) => (
            <Button
              variant="ghost"
              type="button"
              class={["agent-row channel-row", { "agent-row-active": channels.state.selectedId === channel.id }]}
              aria-label={`${channel.name}. ${preview(channel)}`}
              aria-pressed={channels.state.selectedId === channel.id ? "true" : "false"}
              onClick={() => void channels.open(channel.id)}
            >
              <span class="agent-row-avatar">
                <ChannelAvatar members={channel.members} />
                <Show when={channel.unreadCount > 0}>
                  <Badge class="person-unread-badge" tone="accent" shape="pill" aria-hidden="true">
                    {Math.min(channel.unreadCount, 99)}
                  </Badge>
                </Show>
              </span>
              <span class="agent-row-copy">
                <span class="agent-row-heading">
                  <strong>{channel.name}</strong>
                  <span>{sidebarMessageTime(channel.lastMessage?.at ?? channel.createdAt)}</span>
                </span>
                <span class="agent-row-preview">{preview(channel)}</span>
              </span>
              <Show when={channel.unreadCount > 0}>
                <span class="sr-only">{channel.unreadCount} unread messages</span>
              </Show>
            </Button>
          )}
        </For>
      </div>
    </Show>
  );
}
