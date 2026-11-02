import { useState } from "react";
import { Alert } from "react-native";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { type MobileAgent, useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";

/**
 * Starts a new chat with the agent after the user confirms, as on desktop. The agent forgets the
 * messages before it and keeps its setup. The host refuses while the agent works, and its reason
 * shows in the alert.
 */
export function useAgentNewChat(agent: MobileAgent) {
  const { t } = useText();
  const { startNewChat } = useMobileWorkspaceActions();
  const [starting, setStarting] = useState(false);

  function start(): void {
    setStarting(true);
    startNewChat(agent.id, agent.serverId)
      .then(() => {
        void haptics.notification("success");
      })
      .catch((cause: unknown) => {
        void haptics.notification("error");
        const text = currentText();
        showFailureAlert(
          cause,
          "agent",
          text.t("mobile.agent.newChat.failed"),
          text.errorMessage(cause, text.t("mobile.agent.newChat.failedBody")),
        );
      })
      .finally(() => setStarting(false));
  }

  function confirmNewChat(): void {
    Alert.alert(t("mobile.agent.newChat.confirmTitle", { name: agent.name }), t("mobile.agent.newChat.confirmBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("mobile.agent.newChat.confirm"), onPress: start },
    ]);
  }

  return { starting, confirmNewChat };
}
