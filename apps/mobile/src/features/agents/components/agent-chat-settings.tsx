import { Typography } from "heroui-native";
import { useState } from "react";
import { Alert } from "react-native";
import { useUniwind } from "uniwind";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsSwitch } from "@/features/settings/components/settings-controls";
import { type MobileAgent, useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";

/**
 * The notifications switch of the agent settings. The host keeps one value for each agent, which
 * any member can change, and it applies to every member. A change saves at once, as on desktop.
 */
export function AgentNotificationsRow({ agent, available }: { agent: MobileAgent; available: boolean }) {
  const { t } = useText();
  const { updateAgent } = useMobileWorkspace();
  const { theme } = useUniwind();
  // The requested value shows until the host answers, so the switch does not move back during the save.
  const [pending, setPending] = useState<boolean | null>(null);
  if (agent.notifications === undefined) return null;

  async function save(notifications: boolean): Promise<void> {
    setPending(notifications);
    try {
      await updateAgent({ agentId: agent.id, notifications }, agent.serverId);
      void haptics.notification("success");
    } catch (cause) {
      void haptics.notification("error");
      const text = currentText();
      showFailureAlert(
        cause,
        "agent",
        text.t("mobile.agent.notifications.failed"),
        text.errorMessage(cause, text.t("mobile.agent.notifications.failedBody")),
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <SettingsRow>
      <SettingsSwitch
        value={pending ?? agent.notifications}
        disabled={!available || pending !== null}
        label={t("mobile.agent.notifications.title")}
        dark={theme === "dark"}
        onValueChange={(next) => void save(next)}
      />
    </SettingsRow>
  );
}

/**
 * Starts a new chat with the agent after the user confirms, as on desktop. The agent forgets the
 * messages before it and keeps its setup. The host refuses while the agent works, and its reason
 * shows in the alert.
 */
export function AgentNewChatSection({ agent, available }: { agent: MobileAgent; available: boolean }) {
  const { t } = useText();
  const { startNewChat } = useMobileWorkspace();
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

  return (
    <SettingsSection footer={t("mobile.agent.newChat.footer")}>
      <SettingsRow
        disabled={!available || starting}
        onPress={() =>
          Alert.alert(
            t("mobile.agent.newChat.confirmTitle", { name: agent.name }),
            t("mobile.agent.newChat.confirmBody"),
            [
              { text: t("common.cancel"), style: "cancel" },
              { text: t("mobile.agent.newChat.confirm"), onPress: start },
            ],
          )
        }
      >
        <Typography.Paragraph>
          {t(starting ? "mobile.agent.newChat.starting" : "mobile.agent.newChat.title")}
        </Typography.Paragraph>
      </SettingsRow>
    </SettingsSection>
  );
}
