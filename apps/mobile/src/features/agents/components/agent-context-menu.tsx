import { type MenuAction, type MenuComponentRef, MenuView } from "@expo/ui/community/menu";
import * as Clipboard from "expo-clipboard";
import { Link, router } from "expo-router";
import { type PropsWithChildren, type Ref, useRef } from "react";
import { Alert, type StyleProp, type ViewStyle } from "react-native";
import { useUniwind } from "uniwind";
import { useAgentPinTransition } from "@/features/agents/components/agent-pin-transition";
import { useChatSectionMenu } from "@/features/agents/components/use-chat-section-menu";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { useAgentUnread } from "@/features/workspace/components/use-live-workspace";
import { type MobileAgent, useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { canToggleAgentPin } from "@/features/workspace/model/agent-pins";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";

function useAgentMenuActions(agent: MobileAgent) {
  const { deleteAgent, duplicateAgent, hideAgent, markAgentRead, markAgentUnread, pinnedAgentIds, pinnedChannelIds } =
    useMobileWorkspace();
  const { toggleAgentPinAnimated } = useAgentPinTransition();
  const sectionMenu = useChatSectionMenu(agent.serverId, agent.id);
  const isPinned = pinnedAgentIds.includes(agent.id);
  const isUnread = useAgentUnread(agent.id);
  const actionPending = useRef(false);
  const { t } = useText();

  async function runAgentAction(action: "delete" | "duplicate"): Promise<void> {
    if (actionPending.current) return;
    actionPending.current = true;
    try {
      if (action === "delete") await deleteAgent(agent.id);
      else await duplicateAgent(agent.id);
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
    if (isUnread) markAgentRead(agent.id);
    else markAgentUnread(agent.id);
    void haptics.selection();
  };
  const handleHide = () => {
    hideAgent(agent.id);
    void haptics.impact();
  };
  const handleInfo = () =>
    router.push({ pathname: "/agent-info/[agentId]", params: { agentId: agent.id, serverId: agent.serverId } });
  const canPin = canToggleAgentPin([...pinnedAgentIds, ...pinnedChannelIds], agent.id);
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

export function useAgentContextMenu(agent: MobileAgent) {
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

/** The long-press menu of an agent on Android, with the actions of the iOS context menu. */
export function AgentAndroidMenu({
  agent,
  menuRef,
  style,
  children,
}: PropsWithChildren<{ agent: MobileAgent; menuRef?: Ref<MenuComponentRef>; style?: StyleProp<ViewStyle> }>) {
  const { t } = useText();
  const { theme } = useUniwind();
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
    { id: "read", title: t(isUnread ? "mobile.agent.menu.markRead" : "mobile.agent.menu.markUnread") },
    {
      id: "pin",
      title: t(isPinned ? "mobile.agent.pin.unpin" : "mobile.agent.pin.pin"),
      attributes: { disabled: !canPin },
    },
    { id: "hide", title: t("mobile.agent.menu.hide") },
    ...sectionMenu.androidActions,
    { id: "info", title: t("mobile.agent.menu.info") },
    {
      id: "more",
      title: t("mobile.agent.menu.more"),
      subactions: [
        { id: "copy", title: t("mobile.agent.menu.copyId") },
        { id: "duplicate", title: t("mobile.agent.menu.duplicate") },
        { id: "delete", title: t("common.delete"), attributes: { destructive: true } },
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
      ref={menuRef}
      style={style}
      colorScheme={theme === "dark" ? "dark" : "light"}
      shouldOpenOnLongPress
      actions={actions}
      onPressAction={({ nativeEvent }) => {
        sectionMenu.onAction(nativeEvent.event);
        handlers[nativeEvent.event]?.();
      }}
    >
      {children}
    </MenuView>
  );
}
