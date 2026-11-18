import { router } from "expo-router";
import { Typography } from "heroui-native";
import Trash2 from "lucide-react-native/icons/trash";
import { useRef, useState } from "react";
import { Alert } from "react-native";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { RowIcon } from "@/features/settings/components/settings-row-icon";
import { type MobileAgent, useMobileWorkspaceReader } from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";

/**
 * The last group of Agent info: delete the agent, as the agent menu of the chat list does. The host
 * lets only an owner or an admin delete an agent, so the parent shows it only to them. After the
 * delete, the sheet and the chat of the agent under it close.
 */
export function AgentDeleteSection({ agent, disabled }: { agent: MobileAgent; disabled: boolean }) {
  const { t } = useText();
  const workspace = useMobileWorkspaceReader();
  const [deleting, setDeleting] = useState(false);
  const lock = useRef(false);

  async function remove() {
    if (lock.current) return;
    lock.current = true;
    setDeleting(true);
    try {
      await workspace().deleteAgent(agent.id, agent.serverId);
      void haptics.notification("success");
      router.dismissTo("/connected");
    } catch (error) {
      void haptics.notification("error");
      const text = currentText();
      showFailureAlert(
        error,
        "agent",
        text.t("mobile.agent.menu.deleteFailed"),
        text.errorMessage(error, text.t("mobile.agent.menu.actionFailed")),
      );
    } finally {
      lock.current = false;
      setDeleting(false);
    }
  }

  return (
    <SettingsSection>
      <SettingsRow
        leading={<RowIcon icon={Trash2} tone="danger" />}
        disabled={disabled || deleting}
        disclosure={false}
        onPress={() => {
          void haptics.notification("warning");
          const text = currentText();
          Alert.alert(
            text.t("mobile.agent.menu.deleteTitle", { name: agent.name }),
            text.t("mobile.agent.menu.deleteBody"),
            [
              { text: text.t("common.cancel"), style: "cancel" },
              { text: text.t("common.delete"), style: "destructive", onPress: () => void remove() },
            ],
          );
        }}
      >
        <Typography.Paragraph className="text-danger-text">{t("common.delete")}</Typography.Paragraph>
      </SettingsRow>
    </SettingsSection>
  );
}
