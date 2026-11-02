import * as Clipboard from "expo-clipboard";
import { Link, router } from "expo-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { useUniwind } from "uniwind";
import { useAgentPinTransition } from "@/features/agents/components/agent-pin-transition";
import { useChatSectionMenu } from "@/features/agents/components/use-chat-section-menu";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { useAgentUnread } from "@/features/workspace/components/use-live-workspace";
import {
  type MobileAgent,
  useMobileWorkspaceReader,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { canToggleAgentPin } from "@/features/workspace/model/agent-pins";
import { type MenuAction, type MenuComponentRef, MenuView } from "@/shared/components/menu-view";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";

function useAgentMenuActions(agent: MobileAgent) {
  const workspace = useMobileWorkspaceReader();
  const { toggleAgentPinAnimated } = useAgentPinTransition();
  const sectionMenu = useChatSectionMenu(agent.serverId, agent.id);
  const isPinned = useMobileWorkspaceSelector(({ pinnedAgentIds }) => pinnedAgentIds.includes(agent.id));
  const canPin = useMobileWorkspaceSelector(({ pinnedAgentIds, pinnedChannelIds }) =>
    canToggleAgentPin([...pinnedAgentIds, ...pinnedChannelIds], agent.id),
  );
  const isUnread = useAgentUnread(agent.id);
  const actionPending = useRef(false);
  const { t } = useText();

  async function runAgentAction(action: "delete" | "duplicate"): Promise<void> {
    if (actionPending.current) return;
    actionPending.current = true;
    try {
      if (action === "delete") await workspace().deleteAgent(agent.id);
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

  const handleCopyId = () => {
    void Clipboard.setStringAsync(agent.id).then(() => {
      void haptics.notification();
    });
  };

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
    sectionMenu,
    handleRead,
    handlePin,
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
    sectionMenu,
    handleRead,
    handlePin,
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

/**
 * The chat link of an agent on iOS, with its long-press preview and context menu. Android drops both
 * elements from a Link, so it does not build the menu and wraps the link in `AgentAndroidMenu`.
 */
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

/**
 * The long-press menu of an agent on Android, with the actions of the iOS context menu. It opens when
 * it mounts and calls `onClose` when it closes, so the parent mounts it only while it shows: a long
 * list would otherwise keep a menu with every item for each row. It covers its parent, so the menu
 * opens at the row, as it did around the row.
 */
export function AgentAndroidMenu({ agent, onClose }: { agent: MobileAgent; onClose: () => void }) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  return (
    <View
      // The open menu draws in a portal. The row under it keeps its touches.
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={({ nativeEvent }) => setSize({ width: nativeEvent.layout.width, height: nativeEvent.layout.height })}
    >
      {size ? <OpenAgentMenu agent={agent} size={size} onClose={onClose} /> : null}
    </View>
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
  const { theme } = useUniwind();
  const menu = useRef<MenuComponentRef>(null);
  useEffect(() => {
    menu.current?.show();
  }, []);
  const {
    isPinned,
    isUnread,
    canPin,
    sectionMenu,
    handleRead,
    handlePin,
    handleHide,
    handleInfo,
    handleCopyId,
    handleDuplicate,
    handleDelete,
  } = useAgentMenuActions(agent);
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
    hide: handleHide,
    info: handleInfo,
    copy: handleCopyId,
    duplicate: handleDuplicate,
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
