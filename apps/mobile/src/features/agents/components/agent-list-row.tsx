import { markdownPreviewText } from "@openbot/contracts/markdown-preview-text";
import { Link } from "expo-router";
import { Typography } from "heroui-native";
import { memo, useMemo, useState } from "react";
import { View } from "react-native";
import { useAgentChatPreview } from "@/features/agents/components/agent-chat-preview";
import { AgentAndroidMenu, AgentContextMenuLink } from "@/features/agents/components/agent-context-menu";
import { AgentPinSwipeRow } from "@/features/agents/components/agent-pin-swipe-row";
import { AgentUnreadBadge } from "@/features/agents/components/agent-unread-badge";
import { AgentWaitBadge, AgentWaitChip, agentListStateLabel } from "@/features/agents/components/agent-wait-badge";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { AgentDragPreview, useChatDrag, useHoldMenu } from "@/features/agents/components/chat-drag";
import { ChatLinkPressable } from "@/features/agents/components/chat-link-pressable";
import { useChatRowBackground } from "@/features/agents/components/chat-list-pane-context";
import { CHAT_ROW_AVATAR_SIZE, ChatRowHeading, ChatRowTime } from "@/features/agents/components/chat-row";
import { useChatPinToggle } from "@/features/agents/components/use-chat-pin-toggle";
import { useWaitingChannel } from "@/features/channels/components/use-waiting-channel";
import {
  agentListWaitReason,
  useAgentListActivity,
  useAgentListUnreadCount,
  useAgentListUnreadThreads,
} from "@/features/workspace/components/use-agent-activity";
import { type MobileAgent, useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { agentActivityMood } from "@/features/workspace/model/agent-activity";
import { canToggleChatPin } from "@/features/workspace/model/agent-pins";
import { isAndroid, longPressDelay } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { lineDirectionStyle } from "@/shared/lib/text-direction";
import { typeScale } from "@/shared/lib/type-scale";

interface AgentListRowProps {
  agent: MobileAgent;
  leftInset?: number;
  rightInset?: number;
}

export const AgentListRow = memo(function AgentListRow({ agent, leftInset = 20, rightInset = 20 }: AgentListRowProps) {
  const { t } = useText();
  const background = useChatRowBackground(agent.id);
  const pinBlocked = useMobileWorkspaceSelector(
    ({ pinnedAgentIds, pinnedChannelIds }) => !canToggleChatPin(pinnedAgentIds, pinnedChannelIds, agent.id),
  );
  const { toggleAgentPin } = useChatPinToggle();
  const [menuKey, setMenuKey] = useState(0);
  const drag = useChatDrag("row", () => ({
    chat: { kind: "agent", id: agent.id },
    pinned: false,
    name: agent.name,
    preview: <AgentDragPreview agent={agent} />,
  }));
  const holdMenu = useHoldMenu(drag, () => setMenuKey((key) => key + 1));
  const agentChatPreview = useAgentChatPreview(agent);
  const activity = useAgentListActivity(agent.id);
  const waitingChannel = useWaitingChannel(activity, agent.serverId);
  const lastMessage = useMemo(() => markdownPreviewText(agent.preview), [agent.preview]);
  const previewLine = waitingChannel
    ? t("mobile.chat.channelWork.waiting", { channel: waitingChannel.name })
    : lastMessage;
  const unreadCount = useAgentListUnreadCount(agent.id);
  const unreadThreads = useAgentListUnreadThreads(agent.id);
  const waitReason = agentListWaitReason(activity);
  const bloub = (
    <BloubAvatar
      agentId={agent.id}
      serverId={agent.serverId}
      hue={agent.avatarHue}
      color={agent.avatarColor}
      seed={agent.avatarSeed}
      avatarUrl={agent.avatarUrl}
      size={CHAT_ROW_AVATAR_SIZE}
      animateIdle={false}
      rings
      activityMood={agentActivityMood(activity)}
    />
  );
  const waitBadge = waitReason ? (
    <AgentWaitBadge reason={waitReason} />
  ) : unreadCount > 0 || unreadThreads ? (
    <AgentUnreadBadge count={unreadCount} avatarSize={CHAT_ROW_AVATAR_SIZE} ringColor={background} />
  ) : null;
  const avatar = (
    <View style={{ width: CHAT_ROW_AVATAR_SIZE, height: CHAT_ROW_AVATAR_SIZE }}>
      {bloub}
      {waitBadge}
    </View>
  );
  const openLabel = agent.title.trim()
    ? t("mobile.agent.list.openWithTitle", { name: agent.name, title: agent.title.trim() })
    : t("mobile.agent.list.open", { name: agent.name });

  const row = (
    <ChatLinkPressable
      chatId={agent.id}
      accessibilityLabel={agentListStateLabel(t, openLabel, waitReason, unreadCount, unreadThreads)}
      accessibilityRole="button"
      accessibilityActions={[{ name: "pin", label: t("mobile.agent.pin.pinNamed", { name: agent.name }) }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "pin") toggleAgentPin(agent.id);
      }}
      className="w-full"
      onPressIn={agentChatPreview.onPressIn}
      delayLongPress={longPressDelay}
      onLongPress={holdMenu.onLongPress}
      onPressOut={holdMenu.onPressOut}
    >
      {({ pressed }) => (
        <View
          className="min-h-17 w-full flex-row items-center gap-3.5 py-1"
          style={{
            backgroundColor: background,
            opacity: pressed ? 0.58 : 1,
            paddingLeft: leftInset,
            paddingRight: rightInset,
          }}
        >
          {avatar}
          <View className="min-w-0 flex-1 gap-0.5">
            <ChatRowHeading
              name={agent.name}
              title={agent.title.trim()}
              trailing={waitReason ? <AgentWaitChip reason={waitReason} /> : <ChatRowTime label={agent.updatedLabel} />}
            />
            <Typography.Paragraph
              className="text-text-secondary"
              numberOfLines={1}
              style={[typeScale.chatDetail, lineDirectionStyle(previewLine)]}
            >
              {previewLine}
            </Typography.Paragraph>
          </View>
          {agentChatPreview.measurer}
        </View>
      )}
    </ChatLinkPressable>
  );
  return (
    <AgentPinSwipeRow
      agentName={agent.name}
      pinBlocked={pinBlocked}
      onPin={(withHaptic) => toggleAgentPin(agent.id, { haptic: withHaptic })}
      drag={drag}
    >
      {isAndroid ? (
        <View>
          <Link href={{ pathname: "/chat/[agentId]", params: { agentId: agent.id, serverId: agent.serverId } }} asChild>
            <Link.Trigger>{row}</Link.Trigger>
          </Link>
          {menuKey > 0 ? <AgentAndroidMenu key={menuKey} agent={agent} onClose={() => setMenuKey(0)} /> : null}
        </View>
      ) : (
        <AgentContextMenuLink agent={agent} preview={agentChatPreview.preview}>
          {row}
        </AgentContextMenuLink>
      )}
    </AgentPinSwipeRow>
  );
});
