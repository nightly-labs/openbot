import type { AgentImportSkillSource } from "@openbot/contracts/ipc";
import { router, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { useText } from "@/shared/lib/text";

/** Product names, the same in each language. */
export const IMPORT_SOURCE_NAMES = {
  "grok-bot": "Grok Bot",
  "hermes-agent": "Hermes Agent",
} as const satisfies Record<AgentImportSkillSource, string>;

/**
 * Server settings › Import agents (`agent-import-v1`): where the agents are now. Grok Bot and Hermes
 * each make an export file; another OpenBot server uses Transfer, for an owner or admin.
 */
export function ServerImportScreen() {
  const { t } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { canImportAgents, canTransferServer } = useMobileWorkspace();
  if (!canImportAgents(serverId))
    return (
      <SettingsContent>
        <SettingsNote>{t("mobile.server.import.unavailable")}</SettingsNote>
      </SettingsContent>
    );
  const open = (source: AgentImportSkillSource) =>
    router.push({ pathname: "/server-settings/import-guide", params: { serverId, source } });
  return (
    <SettingsContent>
      <SettingsSection title={t("mobile.server.import.sourceTitle")} footer={t("mobile.server.import.sourceLede")}>
        <SettingsRow supportingText={t("mobile.server.import.hermesNote")} onPress={() => open("hermes-agent")}>
          <Typography.Paragraph>{IMPORT_SOURCE_NAMES["hermes-agent"]}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow supportingText={t("mobile.server.import.grokNote")} onPress={() => open("grok-bot")}>
          <Typography.Paragraph>{IMPORT_SOURCE_NAMES["grok-bot"]}</Typography.Paragraph>
        </SettingsRow>
        {canTransferServer(serverId) ? (
          <SettingsRow
            supportingText={t("mobile.server.import.transferNote")}
            onPress={() => router.push({ pathname: "/server-settings/transfer", params: { serverId } })}
          >
            <Typography.Paragraph>{t("mobile.server.import.transfer")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
    </SettingsContent>
  );
}
