import { type MenuComponentRef, MenuView } from "@expo/ui/community/menu";
import type { ChannelSummary } from "@openbot/contracts/ipc";
import * as Clipboard from "expo-clipboard";
import { Link, router } from "expo-router";
import { Typography } from "heroui-native";
import { memo, useRef } from "react";
import { View } from "react-native";
import { useUniwind } from "uniwind";
import { AgentPinAvatar } from "@/features/agents/components/agent-pin-avatar";
import { AgentPinSwipeRow } from "@/features/agents/components/agent-pin-swipe-row";
import { useAgentPinTransition } from "@/features/agents/components/agent-pin-transition";
import { ChatLinkPressable } from "@/features/agents/components/chat-link-pressable";
import { PinnedChatItem } from "@/features/agents/components/pinned-agents-grid";
import { useChatSectionMenu } from "@/features/agents/components/use-chat-section-menu";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { canToggleAgentPin } from "@/features/workspace/model/agent-pins";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { formatUpdatedAt } from "@/shared/lib/format-updated-at";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid } from "@/shared/lib/platform";
import { ChannelAvatar } from "./channel-avatar";

export const ChannelListRow = memo(function ChannelListRow({
  channel,
  serverId,
  agents,
  pinned = false,
}: {
  channel: ChannelSummary;
  serverId: string;
  agents: ReadonlyMap<string, MobileAgent>;
  pinned?: boolean;
}) {
  const { pinnedAgentIds, pinnedChannelIds, hideChannel, servers } = useMobileWorkspace();
  const { toggleChannelPinAnimated } = useAgentPinTransition();
  const { theme } = useUniwind();
  const menu = useRef<MenuComponentRef>(null);
  const sectionMenu = useChatSectionMenu(serverId, channel.id);
  const isPinned = pinnedChannelIds.includes(channel.id);
  const canPin = canToggleAgentPin([...pinnedAgentIds, ...pinnedChannelIds], channel.id);
  const disconnected = !servers.some((server) => server.id === serverId && server.state === "online");
  const togglePin = (withHaptic = true) => {
    toggleChannelPinAnimated(channel, serverId, { haptic: withHaptic });
  };
  const hide = () => {
    if (hideChannel(channel.id, serverId)) void haptics.impact();
  };
  const info = () =>
    router.push({ pathname: "/channel-info/[channelId]", params: { channelId: channel.id, serverId } });
  const copyId = () => {
    void Clipboard.setStringAsync(channel.id).then(() => haptics.notification());
  };
  const link = (
    <Link href={{ pathname: "/channel/[channelId]", params: { channelId: channel.id, serverId } }} asChild>
      <Link.Trigger>
        <ChatLinkPressable
          accessibilityRole="button"
          accessibilityLabel={`Open channel ${channel.name}${channel.title.trim() ? `, ${channel.title.trim()}` : ""}${channel.unreadCount ? `, ${channel.unreadCount} unread messages` : ""}`}
          className="w-full"
          onLongPress={isAndroid ? () => menu.current?.show() : undefined}
          accessibilityActions={[{ name: "pin", label: `${isPinned ? "Unpin" : "Pin"} ${channel.name}` }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === "pin") togglePin();
          }}
        >
          {({ pressed }) => (
            <View
              className={
                pinned
                  ? "w-full items-center gap-2 px-1"
                  : "min-h-20 w-full flex-row items-center gap-3 bg-background py-1"
              }
              style={{ paddingLeft: pinned ? 4 : 15, paddingRight: pinned ? 4 : 24, opacity: pressed ? 0.58 : 1 }}
            >
              <Link.AppleZoom>
                <AgentPinAvatar agentId={channel.id} location={pinned ? "pinned" : "row"} size={pinned ? 64 : 54}>
                  <ChannelAvatar
                    channel={channel}
                    agents={agents}
                    size={pinned ? 64 : 54}
                    disconnected={disconnected}
                  />
                  {pinned && channel.unreadCount > 0 ? (
                    <View className="absolute right-0 top-0 size-3.5 rounded-full border-2 border-background bg-accent" />
                  ) : null}
                </AgentPinAvatar>
              </Link.AppleZoom>
              {pinned ? (
                <View className="w-full gap-0.5">
                  <Typography.Paragraph
                    type="body-xs"
                    align="center"
                    className="w-full text-text-secondary"
                    numberOfLines={1}
                  >
                    {channel.name}
                  </Typography.Paragraph>
                  {channel.title.trim() ? (
                    <Typography.Paragraph type="body-xs" align="center" className="w-full text-muted" numberOfLines={1}>
                      {channel.title.trim()}
                    </Typography.Paragraph>
                  ) : null}
                </View>
              ) : (
                <View className="min-w-0 flex-1 gap-1">
                  <View className="gap-0">
                    <View className="flex-row items-center gap-2">
                      {channel.unreadCount > 0 ? <View className="size-2 rounded-full bg-accent" /> : null}
                      <Typography.Paragraph className="min-w-0 flex-1" weight="semibold" numberOfLines={2}>
                        {channel.name}
                      </Typography.Paragraph>
                      <Typography.Paragraph type="body-xs" className="text-muted">
                        {formatUpdatedAt(channel.lastMessage?.at ?? channel.createdAt)}
                      </Typography.Paragraph>
                    </View>
                    {channel.title.trim() ? (
                      <Typography.Paragraph type="body-xs" className="-mt-1.5 text-muted" numberOfLines={2}>
                        {channel.title.trim()}
                      </Typography.Paragraph>
                    ) : null}
                  </View>
                  <Typography.Paragraph type="body-xs" className="text-text-secondary -mt-1" numberOfLines={1}>
                    {channel.lastMessage?.text ?? "No messages yet"}
                  </Typography.Paragraph>
                </View>
              )}
            </View>
          )}
        </ChatLinkPressable>
      </Link.Trigger>
      {!isAndroid ? (
        <Link.Menu>
          <Link.MenuAction
            icon={isPinned ? "pin.slash" : "pin"}
            isOn={isPinned}
            disabled={!canPin}
            onPress={() => togglePin()}
          >
            {isPinned ? "Unpin" : "Pin"}
          </Link.MenuAction>
          <Link.MenuAction icon="eye.slash" onPress={hide}>
            Hide
          </Link.MenuAction>
          <Link.MenuAction icon="info.circle" onPress={info}>
            Info
          </Link.MenuAction>
          {sectionMenu.menu}
          <Link.MenuAction icon="doc.on.doc" onPress={copyId}>
            Copy ID
          </Link.MenuAction>
        </Link.Menu>
      ) : null}
    </Link>
  );
  const content = isAndroid ? (
    <MenuView
      ref={menu}
      colorScheme={theme}
      shouldOpenOnLongPress
      actions={[
        ...sectionMenu.androidActions,
        { id: "pin", title: isPinned ? "Unpin" : "Pin", attributes: { disabled: !canPin } },
        { id: "hide", title: "Hide" },
        { id: "info", title: "Info" },
        { id: "copy", title: "Copy ID" },
      ]}
      onPressAction={({ nativeEvent }) => {
        sectionMenu.onAction(nativeEvent.event);
        if (nativeEvent.event === "pin") togglePin();
        if (nativeEvent.event === "hide") hide();
        if (nativeEvent.event === "info") info();
        if (nativeEvent.event === "copy") copyId();
      }}
    >
      {link}
    </MenuView>
  ) : (
    link
  );
  return pinned ? (
    <PinnedChatItem>{content}</PinnedChatItem>
  ) : (
    <AgentPinSwipeRow pinned={isPinned} agentName={channel.name} pinBlocked={!canPin} onPin={togglePin}>
      {content}
    </AgentPinSwipeRow>
  );
});
