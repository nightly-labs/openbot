import { coordinatorText } from "@openbot/contracts/coordinator-text";
import type { ChannelSummary } from "@openbot/contracts/ipc";
import { markdownPreviewText } from "@openbot/contracts/markdown-preview-text";
import * as Crypto from "expo-crypto";
import { Link, router } from "expo-router";
import { Typography } from "heroui-native";
import { memo, type ReactNode, useMemo, useRef, useState } from "react";
import { Alert, View } from "react-native";
import { AndroidRowMenu, OpenRowMenu } from "@/features/agents/components/agent-context-menu";
import { AgentPinAvatar } from "@/features/agents/components/agent-pin-avatar";
import { AgentPinSwipeRow } from "@/features/agents/components/agent-pin-swipe-row";
import { useAgentPinTransition } from "@/features/agents/components/agent-pin-transition";
import { AvatarCutout, useAvatarHole } from "@/features/agents/components/avatar-cutout";
import { ChatDragArea, DRAG_AVATAR_SIZE, useChatDrag, useHoldMenu } from "@/features/agents/components/chat-drag";
import { ChatLinkPressable } from "@/features/agents/components/chat-link-pressable";
import { useChatRowBackground } from "@/features/agents/components/chat-list-pane-context";
import {
  CHAT_ROW_AVATAR_SIZE,
  ChatRowHeading,
  ChatRowTime,
  PINNED_AVATAR_SIZE,
} from "@/features/agents/components/chat-row";
import { PinnedChatItem } from "@/features/agents/components/pinned-agents-grid";
import { useChatSectionMenu } from "@/features/agents/components/use-chat-section-menu";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import {
  useMobileWorkspaceReader,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { canToggleChatPin } from "@/features/workspace/model/agent-pins";
import { showsOnline } from "@/features/workspace/model/server-status";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import type { MenuAction } from "@/shared/components/menu-view";
import { copyWithHaptic } from "@/shared/lib/clipboard";
import { formatUpdatedAt } from "@/shared/lib/format-updated-at";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid, longPressDelay } from "@/shared/lib/platform";
import { currentText, useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";
import { ChannelAvatar } from "./channel-avatar";

function useChannelMenuActions(channel: ChannelSummary, serverId: string) {
  const { t } = useText();
  const workspace = useMobileWorkspaceReader();
  const { toggleChannelPinAnimated } = useAgentPinTransition();
  const sectionMenu = useChatSectionMenu(serverId, channel.id);
  const isPinned = useMobileWorkspaceSelector(({ pinnedChannelIds }) => pinnedChannelIds.includes(channel.id));
  const canPin = useMobileWorkspaceSelector(({ pinnedAgentIds, pinnedChannelIds }) =>
    canToggleChatPin(pinnedAgentIds, pinnedChannelIds, channel.id),
  );
  const online = useMobileWorkspaceSelector(({ servers }) =>
    servers.some((server) => server.id === serverId && showsOnline(server)),
  );
  const isMember = useMobileWorkspaceSelector(
    ({ servers }) => servers.find((server) => server.id === serverId)?.role === "member",
  );
  const canDelete = online && !isMember && !channel.archived;
  const deleteBlocked = channel.activeTasks > 0;
  const deleting = useRef(false);
  const handlePin = (withHaptic = true) => toggleChannelPinAnimated(channel, serverId, { haptic: withHaptic });
  const handleHide = () => {
    if (workspace().hideChannel(channel.id, serverId)) void haptics.impact();
  };
  const handleInfo = () =>
    router.push({ pathname: "/channel-info/[channelId]", params: { channelId: channel.id, serverId } });
  const handleCopyId = () => copyWithHaptic(channel.id);
  const handleDelete = () =>
    Alert.alert(t("mobile.channel.list.deleteTitle", { name: channel.name }), t("mobile.channel.list.deleteBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: () => {
          if (deleting.current) return;
          deleting.current = true;
          workspace()
            .channelStore.command(serverId, {
              type: "archive",
              operationId: Crypto.randomUUID(),
              channelId: channel.id,
            })
            .then(() => haptics.notification())
            .catch((cause: unknown) => {
              void haptics.notification("error");
              const text = currentText();
              showFailureAlert(
                cause,
                "team",
                text.t("mobile.channel.list.deleteFailed"),
                text.errorMessage(cause, text.t("mobile.channel.list.deleteFailedBody")),
              );
            })
            .finally(() => {
              deleting.current = false;
            });
        },
      },
    ]);
  return {
    isPinned,
    canPin,
    canDelete,
    deleteBlocked,
    sectionMenu,
    handlePin,
    handleHide,
    handleInfo,
    handleCopyId,
    handleDelete,
  };
}

function ChannelContextMenuLink({
  channel,
  serverId,
  children,
}: {
  channel: ChannelSummary;
  serverId: string;
  children: ReactNode;
}) {
  const { t } = useText();
  const {
    isPinned,
    canPin,
    canDelete,
    deleteBlocked,
    sectionMenu,
    handlePin,
    handleHide,
    handleInfo,
    handleCopyId,
    handleDelete,
  } = useChannelMenuActions(channel, serverId);
  return (
    <Link href={{ pathname: "/channel/[channelId]", params: { channelId: channel.id, serverId } }} asChild>
      <Link.Trigger>{children}</Link.Trigger>
      <Link.Menu>
        <Link.MenuAction
          icon={isPinned ? "pin.slash" : "pin"}
          isOn={isPinned}
          disabled={!canPin}
          onPress={() => handlePin()}
        >
          {t(isPinned ? "mobile.agent.pin.unpin" : "mobile.agent.pin.pin")}
        </Link.MenuAction>
        <Link.MenuAction icon="eye.slash" onPress={handleHide}>
          {t("mobile.agent.menu.hide")}
        </Link.MenuAction>
        {sectionMenu.menu}
        <Link.MenuAction icon="info.circle" onPress={handleInfo}>
          {t("mobile.agent.menu.info")}
        </Link.MenuAction>
        <Link.Menu icon="ellipsis" title={t("mobile.agent.menu.more")}>
          <Link.MenuAction icon="doc.on.doc" onPress={handleCopyId}>
            {t("mobile.agent.menu.copyId")}
          </Link.MenuAction>
          {canDelete ? (
            <Link.MenuAction destructive icon="trash" disabled={deleteBlocked} onPress={handleDelete}>
              {t("common.delete")}
            </Link.MenuAction>
          ) : null}
        </Link.Menu>
      </Link.Menu>
    </Link>
  );
}

function ChannelAndroidMenu({
  channel,
  serverId,
  onClose,
}: {
  channel: ChannelSummary;
  serverId: string;
  onClose: () => void;
}) {
  return (
    <AndroidRowMenu>
      {(size) => <OpenChannelMenu channel={channel} serverId={serverId} size={size} onClose={onClose} />}
    </AndroidRowMenu>
  );
}

function OpenChannelMenu({
  channel,
  serverId,
  size,
  onClose,
}: {
  channel: ChannelSummary;
  serverId: string;
  size: { width: number; height: number };
  onClose: () => void;
}) {
  const { t } = useText();
  const {
    isPinned,
    canPin,
    canDelete,
    deleteBlocked,
    sectionMenu,
    handlePin,
    handleHide,
    handleInfo,
    handleCopyId,
    handleDelete,
  } = useChannelMenuActions(channel, serverId);
  const actions: MenuAction[] = [
    {
      id: "pin",
      title: t(isPinned ? "mobile.agent.pin.unpin" : "mobile.agent.pin.pin"),
      image: isPinned ? "pin.slash" : "pin",
      attributes: { disabled: !canPin },
    },
    { id: "hide", title: t("mobile.agent.menu.hide"), image: "eye.slash" },
    ...sectionMenu.androidActions,
    { id: "info", title: t("mobile.agent.menu.info"), image: "info.circle" },
    {
      id: "more",
      title: t("mobile.agent.menu.more"),
      image: "ellipsis",
      subactions: [
        { id: "copy", title: t("mobile.agent.menu.copyId"), image: "doc.on.doc" },
        {
          id: "delete",
          title: t("common.delete"),
          image: "trash",
          attributes: { destructive: true, hidden: !canDelete, disabled: deleteBlocked },
        },
      ],
    },
  ];
  const handlers: Record<string, () => void> = {
    pin: () => handlePin(),
    hide: handleHide,
    info: handleInfo,
    copy: handleCopyId,
    delete: handleDelete,
  };
  return (
    <OpenRowMenu
      actions={actions}
      size={size}
      onClose={onClose}
      onAction={(id) => {
        sectionMenu.onAction(id);
        handlers[id]?.();
      }}
    />
  );
}

function PinnedUnreadDot() {
  const reportHole = useAvatarHole();
  return (
    <View pointerEvents="none" className="absolute right-0 top-0 rounded-full p-0.5" onLayout={reportHole}>
      <View className="size-2.5 rounded-full bg-accent" />
    </View>
  );
}

export const ChannelListRow = memo(function ChannelListRow({
  channel,
  serverId,
  agents,
  pinned = false,
  leftInset = 20,
  rightInset = 20,
}: {
  channel: ChannelSummary;
  serverId: string;
  agents: ReadonlyMap<string, MobileAgent>;
  pinned?: boolean;
  leftInset?: number;
  rightInset?: number;
}) {
  const { t, format, sourceText } = useText();
  const rowBackground = useChatRowBackground(channel.id);
  const { toggleChannelPinAnimated } = useAgentPinTransition();
  const isPinned = useMobileWorkspaceSelector(({ pinnedChannelIds }) => pinnedChannelIds.includes(channel.id));
  const pinBlocked = useMobileWorkspaceSelector(
    ({ pinnedAgentIds, pinnedChannelIds }) => !canToggleChatPin(pinnedAgentIds, pinnedChannelIds, channel.id),
  );
  const disconnected = useMobileWorkspaceSelector(
    ({ servers }) => !servers.some((server) => server.id === serverId && showsOnline(server)),
  );
  const [menuKey, setMenuKey] = useState(0);
  const drag = useChatDrag(pinned ? "pin" : "row", () => ({
    chat: { kind: "channel", id: channel.id },
    pinned,
    name: channel.name,
    preview: (
      <ChannelAvatar
        channel={channel}
        agents={agents}
        size={DRAG_AVATAR_SIZE}
        serverId={serverId}
        disconnected={disconnected}
      />
    ),
  }));
  const holdMenu = useHoldMenu(drag, () => setMenuKey((key) => key + 1));
  const previewLine = useMemo(
    () =>
      channel.lastMessage
        ? markdownPreviewText(coordinatorText(channel.lastMessage.author, channel.lastMessage.text, sourceText))
        : t("mobile.channel.list.noMessages"),
    [channel.lastMessage, t, sourceText],
  );
  const title = channel.title.trim();
  const unread = channel.unreadCount > 0;
  const togglePin = (withHaptic = true) => toggleChannelPinAnimated(channel, serverId, { haptic: withHaptic });
  const openLabel = title
    ? t("mobile.channel.list.openWithTitle", { name: channel.name, title })
    : t("mobile.channel.list.open", { name: channel.name });
  const size = pinned ? PINNED_AVATAR_SIZE : CHAT_ROW_AVATAR_SIZE;
  const channelAvatar = (
    <ChannelAvatar channel={channel} agents={agents} size={size} serverId={serverId} disconnected={disconnected} />
  );
  const avatar = (
    <AgentPinAvatar agentId={channel.id} location={pinned ? "pinned" : "row"} size={size}>
      {pinned ? (
        <AvatarCutout size={size} badge={unread ? <PinnedUnreadDot /> : null}>
          {channelAvatar}
        </AvatarCutout>
      ) : (
        channelAvatar
      )}
    </AgentPinAvatar>
  );

  const trigger = (
    <ChatLinkPressable
      chatId={channel.id}
      accessibilityRole="button"
      accessibilityLabel={
        unread ? `${openLabel}, ${t("mobile.channel.list.unread", { count: channel.unreadCount })}` : openLabel
      }
      accessibilityActions={[
        {
          name: "pin",
          label: t(isPinned ? "mobile.agent.pin.unpinNamed" : "mobile.agent.pin.pinNamed", { name: channel.name }),
        },
      ]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "pin") togglePin();
      }}
      className={pinned ? "w-full items-center gap-2 px-1" : "w-full"}
      delayLongPress={longPressDelay}
      onLongPress={holdMenu.onLongPress}
      onPressOut={holdMenu.onPressOut}
      style={pinned ? ({ pressed }) => ({ opacity: pressed ? 0.58 : 1 }) : undefined}
    >
      {pinned ? (
        <>
          {avatar}
          <Typography.Paragraph
            align="center"
            className="w-full text-text-secondary"
            numberOfLines={1}
            style={typeScale.pinnedName}
          >
            {channel.name}
          </Typography.Paragraph>
        </>
      ) : (
        ({ pressed }) => (
          <View
            className="min-h-21 w-full flex-row items-center gap-3.5 py-1"
            style={{
              backgroundColor: rowBackground,
              opacity: pressed ? 0.58 : 1,
              paddingLeft: leftInset,
              paddingRight: rightInset,
            }}
          >
            {avatar}
            <View className="min-w-0 flex-1 gap-0.5">
              <ChatRowHeading
                name={channel.name}
                title={title}
                leading={unread ? <View className="size-2.5 rounded-full bg-accent" /> : null}
                trailing={<ChatRowTime label={formatUpdatedAt(channel.lastMessage?.at ?? channel.createdAt, format)} />}
              />
              <Typography.Paragraph className="text-text-secondary" numberOfLines={1} style={typeScale.chatDetail}>
                {previewLine}
              </Typography.Paragraph>
            </View>
          </View>
        )
      )}
    </ChatLinkPressable>
  );
  const content = isAndroid ? (
    <View className={pinned ? "w-full" : undefined}>
      <Link href={{ pathname: "/channel/[channelId]", params: { channelId: channel.id, serverId } }} asChild>
        <Link.Trigger>{trigger}</Link.Trigger>
      </Link>
      {menuKey > 0 ? (
        <ChannelAndroidMenu key={menuKey} channel={channel} serverId={serverId} onClose={() => setMenuKey(0)} />
      ) : null}
    </View>
  ) : (
    <ChannelContextMenuLink channel={channel} serverId={serverId}>
      {trigger}
    </ChannelContextMenuLink>
  );
  return pinned ? (
    <PinnedChatItem>
      <ChatDragArea drag={drag} fill>
        {content}
      </ChatDragArea>
    </PinnedChatItem>
  ) : (
    <AgentPinSwipeRow pinned={isPinned} agentName={channel.name} pinBlocked={pinBlocked} onPin={togglePin} drag={drag}>
      {content}
    </AgentPinSwipeRow>
  );
});
