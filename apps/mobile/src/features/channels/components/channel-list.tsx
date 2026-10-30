import type { ChannelSummary } from "@openbot/contracts/ipc";
import { markdownPreviewText } from "@openbot/contracts/markdown-preview-text";
import * as Clipboard from "expo-clipboard";
import * as Crypto from "expo-crypto";
import { Link, router } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { memo, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { useUniwind } from "uniwind";
import { AgentPinAvatar } from "@/features/agents/components/agent-pin-avatar";
import { AgentPinSwipeRow } from "@/features/agents/components/agent-pin-swipe-row";
import { useAgentPinTransition } from "@/features/agents/components/agent-pin-transition";
import { ChatLinkPressable } from "@/features/agents/components/chat-link-pressable";
import { useChatRowBackground } from "@/features/agents/components/chat-list-pane-context";
import { ChatZoomSource } from "@/features/agents/components/chat-zoom-source";
import { PinnedChatItem } from "@/features/agents/components/pinned-agents-grid";
import { useChatSectionMenu } from "@/features/agents/components/use-chat-section-menu";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import {
  useMobileWorkspaceReader,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { canToggleAgentPin } from "@/features/workspace/model/agent-pins";
import { showsOnline } from "@/features/workspace/model/server-status";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { type MenuAction, type MenuComponentRef, MenuView } from "@/shared/components/menu-view";
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
    canToggleAgentPin([...pinnedAgentIds, ...pinnedChannelIds], channel.id),
  );
  const online = useMobileWorkspaceSelector(({ servers }) =>
    servers.some((server) => server.id === serverId && showsOnline(server)),
  );
  const isMember = useMobileWorkspaceSelector(
    ({ servers }) => servers.find((server) => server.id === serverId)?.role === "member",
  );
  const canDelete = online && !isMember && !channel.archived;
  const deleting = useRef(false);
  const handlePin = (withHaptic = true) => toggleChannelPinAnimated(channel, serverId, { haptic: withHaptic });
  const handleHide = () => {
    if (workspace().hideChannel(channel.id, serverId)) void haptics.impact();
  };
  const handleInfo = () =>
    router.push({ pathname: "/channel-info/[channelId]", params: { channelId: channel.id, serverId } });
  const handleCopyId = () => {
    void Clipboard.setStringAsync(channel.id).then(() => haptics.notification());
  };
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
  return { isPinned, canPin, canDelete, sectionMenu, handlePin, handleHide, handleInfo, handleCopyId, handleDelete };
}

/** The chat link of a channel on iOS, with its context menu. Android uses `ChannelAndroidMenu`. */
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
  const { isPinned, canPin, canDelete, sectionMenu, handlePin, handleHide, handleInfo, handleCopyId, handleDelete } =
    useChannelMenuActions(channel, serverId);
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
            <Link.MenuAction destructive icon="trash" onPress={handleDelete}>
              {t("common.delete")}
            </Link.MenuAction>
          ) : null}
        </Link.Menu>
      </Link.Menu>
    </Link>
  );
}

/** The long-press menu of a channel on Android. It opens when it mounts, as `AgentAndroidMenu` does. */
function ChannelAndroidMenu({
  channel,
  serverId,
  onClose,
}: {
  channel: ChannelSummary;
  serverId: string;
  onClose: () => void;
}) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  return (
    <View
      // The open menu draws in a portal. The row under it keeps its touches.
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={({ nativeEvent }) => setSize({ width: nativeEvent.layout.width, height: nativeEvent.layout.height })}
    >
      {size ? <OpenChannelMenu channel={channel} serverId={serverId} size={size} onClose={onClose} /> : null}
    </View>
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
  const { theme } = useUniwind();
  const menu = useRef<MenuComponentRef>(null);
  useEffect(() => {
    menu.current?.show();
  }, []);
  const { isPinned, canPin, canDelete, sectionMenu, handlePin, handleHide, handleInfo, handleCopyId, handleDelete } =
    useChannelMenuActions(channel, serverId);
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
          attributes: { destructive: true, hidden: !canDelete },
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
    <MenuView
      ref={menu}
      colorScheme={theme === "dark" ? "dark" : "light"}
      shouldOpenOnLongPress
      actions={actions}
      onCloseMenu={onClose}
      onPressAction={({ nativeEvent }) => {
        sectionMenu.onAction(nativeEvent.event);
        handlers[nativeEvent.event]?.();
      }}
    >
      {/* The anchor of the menu: the size of the row it covers. */}
      <View style={size} />
    </MenuView>
  );
}

/** A channel in the home list, or in the pinned grid, with the look and menus of an agent chat. */
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
  const { t, format } = useText();
  const [background, accent] = useThemeColor(["background", "accent"]);
  const rowBackground = useChatRowBackground(channel.id);
  const { toggleChannelPinAnimated } = useAgentPinTransition();
  const isPinned = useMobileWorkspaceSelector(({ pinnedChannelIds }) => pinnedChannelIds.includes(channel.id));
  const pinBlocked = useMobileWorkspaceSelector(
    ({ pinnedAgentIds, pinnedChannelIds }) => !canToggleAgentPin([...pinnedAgentIds, ...pinnedChannelIds], channel.id),
  );
  const disconnected = useMobileWorkspaceSelector(
    ({ servers }) => !servers.some((server) => server.id === serverId && showsOnline(server)),
  );
  // Each long press mounts the Android menu again, so it opens even if an earlier one did not close.
  const [menuKey, setMenuKey] = useState(0);
  const previewLine = useMemo(
    () => (channel.lastMessage ? markdownPreviewText(channel.lastMessage.text) : t("mobile.channel.list.noMessages")),
    [channel.lastMessage, t],
  );
  const title = channel.title.trim();
  const unread = channel.unreadCount > 0;
  const togglePin = (withHaptic = true) => toggleChannelPinAnimated(channel, serverId, { haptic: withHaptic });
  const openLabel = title
    ? t("mobile.channel.list.openWithTitle", { name: channel.name, title })
    : t("mobile.channel.list.open", { name: channel.name });
  const size = pinned ? 64 : 54;
  const avatar = (
    <ChatZoomSource>
      <AgentPinAvatar agentId={channel.id} location={pinned ? "pinned" : "row"} size={size}>
        <ChannelAvatar channel={channel} agents={agents} size={size} disconnected={disconnected} />
        {pinned && unread ? (
          <View
            className="absolute right-0 top-0 size-3.5 rounded-full border-2 bg-accent"
            style={{ borderColor: background, backgroundColor: accent }}
          />
        ) : null}
      </AgentPinAvatar>
    </ChatZoomSource>
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
      onLongPress={() => {
        void haptics.longPress();
        if (isAndroid) setMenuKey((key) => key + 1);
      }}
      style={pinned ? ({ pressed }) => ({ opacity: pressed ? 0.58 : 1 }) : undefined}
    >
      {pinned ? (
        <>
          {avatar}
          <View className="w-full gap-0.5">
            <Typography.Paragraph
              align="center"
              className="w-full text-text-secondary"
              numberOfLines={1}
              style={typeScale.small}
            >
              {channel.name}
            </Typography.Paragraph>
            {title ? (
              <Typography.Paragraph
                align="center"
                className="w-full text-muted"
                numberOfLines={1}
                style={typeScale.small}
              >
                {title}
              </Typography.Paragraph>
            ) : null}
          </View>
        </>
      ) : (
        ({ pressed }) => (
          <View
            className="min-h-20 w-full flex-row items-center gap-3 py-1"
            style={{
              backgroundColor: rowBackground,
              opacity: pressed ? 0.58 : 1,
              paddingLeft: leftInset,
              paddingRight: rightInset,
            }}
          >
            {avatar}
            <View className="min-w-0 flex-1 gap-0.5">
              <View className="flex-row items-center gap-2">
                {unread ? <View className="size-2 rounded-full bg-accent" /> : null}
                <Typography.Paragraph
                  className="font-semibold min-w-0 flex-1"
                  numberOfLines={1}
                  style={typeScale.rowTitle}
                >
                  {channel.name}
                </Typography.Paragraph>
                <Typography.Paragraph className="text-muted" style={typeScale.caption}>
                  {formatUpdatedAt(channel.lastMessage?.at ?? channel.createdAt, format)}
                </Typography.Paragraph>
              </View>
              {title ? (
                <Typography.Paragraph className="text-muted" numberOfLines={1} style={typeScale.caption}>
                  {title}
                </Typography.Paragraph>
              ) : null}
              <Typography.Paragraph className="text-text-secondary" numberOfLines={1} style={typeScale.preview}>
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
    <PinnedChatItem>{content}</PinnedChatItem>
  ) : (
    <AgentPinSwipeRow pinned={isPinned} agentName={channel.name} pinBlocked={pinBlocked} onPin={togglePin}>
      {content}
    </AgentPinSwipeRow>
  );
});
