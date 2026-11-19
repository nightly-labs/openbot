import { agentNotificationLevelMap } from "@openbot/contracts/ipc";
import { Link, router } from "expo-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { useUniwind } from "uniwind";
import { useAgentPinTransition } from "@/features/agents/components/agent-pin-transition";
import { useChatSectionMenu } from "@/features/agents/components/use-chat-section-menu";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import {
  setSyncedNotificationLevels,
  useSyncedNotificationLevels,
} from "@/features/settings/model/notification-levels";
import { useAgentUnread } from "@/features/workspace/components/use-live-workspace";
import {
  type MobileAgent,
  useMobileWorkspaceReader,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { canToggleChatPin } from "@/features/workspace/model/agent-pins";
import { type MenuAction, type MenuComponentRef, MenuView } from "@/shared/components/menu-view";
import { copyWithHaptic } from "@/shared/lib/clipboard";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";

function useAgentMenuActions(agent: MobileAgent) {
  const workspace = useMobileWorkspaceReader();
  const { toggleAgentPinAnimated } = useAgentPinTransition();
  const sectionMenu = useChatSectionMenu(agent.serverId, agent.id);
  const isPinned = useMobileWorkspaceSelector(({ pinnedAgentIds }) => pinnedAgentIds.includes(agent.id));
  const canPin = useMobileWorkspaceSelector(({ pinnedAgentIds, pinnedChannelIds }) =>
    canToggleChatPin(pinnedAgentIds, pinnedChannelIds, agent.id),
  );
  const isUnread = useAgentUnread(agent.id);
  const levels = useSyncedNotificationLevels((state) => state.servers[agent.serverId]);
  const canMute =
    useMobileWorkspaceSelector(({ canSetAgentNotificationLevel }) => canSetAgentNotificationLevel(agent.serverId)) &&
    levels !== undefined;
  const isMuted = levels ? agentNotificationLevelMap(levels).get(agent.id) === "nothing" : false;
  const actionPending = useRef(false);
  const { t } = useText();

  async function runAgentAction(action: "delete" | "duplicate"): Promise<void> {
    if (actionPending.current) return;
    actionPending.current = true;
    try {
      if (action === "delete") await workspace().deleteAgent(agent.id, agent.serverId);
      else await workspace().duplicateAgent(agent.id);
      void haptics.notification();
    } catch (error) {
      void haptics.notification("error");
      const text = currentText();
      showFailureAlert(
        error,
        "agent",
        text.t(action === "delete" ? "mobile.agent.menu.deleteFailed" : "mobile.agent.menu.duplicateFailed"),
        text.errorMessage(error, text.t("mobile.agent.menu.actionFailed")),
      );
    } finally {
      actionPending.current = false;
    }
  }

  const handlePin = () => toggleAgentPinAnimated(agent.id);

  const handleCopyId = () => copyWithHaptic(agent.id);

  const handleDelete = () => {
    Alert.alert(t("mobile.agent.menu.deleteTitle", { name: agent.name }), t("mobile.agent.menu.deleteBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: () => {
          void runAgentAction("delete");
        },
      },
    ]);
  };

  const handleRead = () => {
    if (isUnread) workspace().markAgentRead(agent.id);
    else workspace().markAgentUnread(agent.id);
    void haptics.selection();
  };
  const handleMute = () => {
    void haptics.selection();
    workspace()
      .setAgentNotificationLevel({ agentId: agent.id, level: isMuted ? null : "nothing" }, agent.serverId)
      .then((snapshot) => setSyncedNotificationLevels(agent.serverId, snapshot))
      .catch((error: unknown) => {
        void haptics.notification("error");
        const text = currentText();
        showFailureAlert(
          error,
          "agent",
          text.t("mobile.agent.notifications.failed"),
          text.errorMessage(error, text.t("mobile.agent.notifications.failedBody")),
        );
      });
  };
  const handleHide = () => {
    workspace().hideAgent(agent.id);
    void haptics.impact();
  };
  const handleInfo = () =>
    router.push({ pathname: "/agent-info/[agentId]", params: { agentId: agent.id, serverId: agent.serverId } });
  const handleDuplicate = () => {
    void runAgentAction("duplicate");
  };
  return {
    isPinned,
    isUnread,
    canPin,
    canMute,
    isMuted,
    sectionMenu,
    handleRead,
    handlePin,
    handleMute,
    handleHide,
    handleInfo,
    handleCopyId,
    handleDuplicate,
    handleDelete,
  };
}

function useAgentContextMenu(agent: MobileAgent) {
  const { t } = useText();
  const {
    isPinned,
    isUnread,
    canPin,
    canMute,
    isMuted,
    sectionMenu,
    handleRead,
    handlePin,
    handleMute,
    handleHide,
    handleInfo,
    handleCopyId,
    handleDuplicate,
    handleDelete,
  } = useAgentMenuActions(agent);
  return (
    <Link.Menu>
      <Link.MenuAction icon={isUnread ? "envelope.open" : "envelope.badge"} onPress={handleRead}>
        {t(isUnread ? "mobile.agent.menu.markRead" : "mobile.agent.menu.markUnread")}
      </Link.MenuAction>
      <Link.MenuAction icon={isPinned ? "pin.slash" : "pin"} isOn={isPinned} onPress={handlePin} disabled={!canPin}>
        {t(isPinned ? "mobile.agent.pin.unpin" : "mobile.agent.pin.pin")}
      </Link.MenuAction>
      {canMute ? (
        <Link.MenuAction icon={isMuted ? "bell" : "bell.slash"} onPress={handleMute}>
          {t(isMuted ? "mobile.agent.menu.unmute" : "mobile.agent.menu.mute")}
        </Link.MenuAction>
      ) : null}
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
        <Link.MenuAction icon="plus.square.on.square" onPress={handleDuplicate}>
          {t("mobile.agent.menu.duplicate")}
        </Link.MenuAction>
        <Link.MenuAction destructive icon="trash" onPress={handleDelete}>
          {t("common.delete")}
        </Link.MenuAction>
      </Link.Menu>
    </Link.Menu>
  );
}

export function AgentContextMenuLink({
  agent,
  preview,
  children,
}: {
  agent: MobileAgent;
  preview: ReactNode;
  children: ReactNode;
}) {
  const agentContextMenu = useAgentContextMenu(agent);
  return (
    <Link href={{ pathname: "/chat/[agentId]", params: { agentId: agent.id } }} asChild>
      <Link.Trigger>{children}</Link.Trigger>
      {preview}
      {agentContextMenu}
    </Link>
  );
}

export function AgentAndroidMenu({ agent, onClose }: { agent: MobileAgent; onClose: () => void }) {
  return <AndroidRowMenu>{(size) => <OpenAgentMenu agent={agent} size={size} onClose={onClose} />}</AndroidRowMenu>;
}

export function AndroidRowMenu({ children }: { children: (size: { width: number; height: number }) => ReactNode }) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={({ nativeEvent }) => setSize({ width: nativeEvent.layout.width, height: nativeEvent.layout.height })}
    >
      {size ? children(size) : null}
    </View>
  );
}

export function OpenRowMenu({
  actions,
  size,
  onClose,
  onAction,
}: {
  actions: MenuAction[];
  size: { width: number; height: number };
  onClose: () => void;
  onAction: (id: string) => void;
}) {
  const { theme } = useUniwind();
  const menu = useRef<MenuComponentRef>(null);
  useEffect(() => {
    menu.current?.show();
  }, []);
  return (
    <MenuView
      ref={menu}
      colorScheme={theme === "dark" ? "dark" : "light"}
      shouldOpenOnLongPress
      actions={actions}
      onCloseMenu={onClose}
      onPressAction={({ nativeEvent }) => onAction(nativeEvent.event)}
    >
      <View style={size} />
    </MenuView>
  );
}

function OpenAgentMenu({
  agent,
  size,
  onClose,
}: {
  agent: MobileAgent;
  size: { width: number; height: number };
  onClose: () => void;
}) {
  const { t } = useText();
  const {
    isPinned,
    isUnread,
    canPin,
    canMute,
    isMuted,
    sectionMenu,
    handleRead,
    handlePin,
    handleMute,
    handleHide,
    handleInfo,
    handleCopyId,
    handleDuplicate,
    handleDelete,
  } = useAgentMenuActions(agent);
  const muteAction: MenuAction = {
    id: "mute",
    title: t(isMuted ? "mobile.agent.menu.unmute" : "mobile.agent.menu.mute"),
    image: isMuted ? "bell" : "bell.slash",
  };
  const actions: MenuAction[] = [
    {
      id: "read",
      title: t(isUnread ? "mobile.agent.menu.markRead" : "mobile.agent.menu.markUnread"),
      image: isUnread ? "envelope.open" : "envelope.badge",
    },
    {
      id: "pin",
      title: t(isPinned ? "mobile.agent.pin.unpin" : "mobile.agent.pin.pin"),
      image: isPinned ? "pin.slash" : "pin",
      attributes: { disabled: !canPin },
    },
    ...(canMute ? [muteAction] : []),
    { id: "hide", title: t("mobile.agent.menu.hide"), image: "eye.slash" },
    ...sectionMenu.androidActions,
    { id: "info", title: t("mobile.agent.menu.info"), image: "info.circle" },
    {
      id: "more",
      title: t("mobile.agent.menu.more"),
      image: "ellipsis",
      subactions: [
        { id: "copy", title: t("mobile.agent.menu.copyId"), image: "doc.on.doc" },
        { id: "duplicate", title: t("mobile.agent.menu.duplicate"), image: "plus.square.on.square" },
        { id: "delete", title: t("common.delete"), image: "trash", attributes: { destructive: true } },
      ],
    },
  ];
  const handlers: Record<string, () => void> = {
    read: handleRead,
    pin: handlePin,
    mute: handleMute,
    hide: handleHide,
    info: handleInfo,
    copy: handleCopyId,
    duplicate: handleDuplicate,
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
