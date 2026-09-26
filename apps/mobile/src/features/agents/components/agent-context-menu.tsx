import * as Clipboard from "expo-clipboard";
import { Link, router } from "expo-router";
import { useRef } from "react";
import { Alert } from "react-native";
import { useAgentPinTransition } from "@/features/agents/components/agent-pin-transition";
import { useChatSectionMenu } from "@/features/agents/components/use-chat-section-menu";
import { useAgentUnread } from "@/features/workspace/components/use-live-workspace";
import { type MobileAgent, useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { canToggleAgentPin } from "@/features/workspace/model/agent-pins";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";

export function useAgentContextMenu(agent: MobileAgent) {
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
      const text = currentText();
      Alert.alert(
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
  return (
    <Link.Menu>
      <Link.MenuAction icon={isUnread ? "envelope.open" : "envelope.badge"} onPress={handleRead}>
        {t(isUnread ? "mobile.agent.menu.markRead" : "mobile.agent.menu.markUnread")}
      </Link.MenuAction>
      <Link.MenuAction
        icon={isPinned ? "pin.slash" : "pin"}
        isOn={isPinned}
        onPress={handlePin}
        disabled={!canToggleAgentPin([...pinnedAgentIds, ...pinnedChannelIds], agent.id)}
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
        <Link.MenuAction
          icon="plus.square.on.square"
          onPress={() => {
            void runAgentAction("duplicate");
          }}
        >
          {t("mobile.agent.menu.duplicate")}
        </Link.MenuAction>
        <Link.MenuAction destructive icon="trash" onPress={handleDelete}>
          {t("common.delete")}
        </Link.MenuAction>
      </Link.Menu>
    </Link.Menu>
  );
}
