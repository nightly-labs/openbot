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

/**
 * Server settings › Transfer (`instance-transfer-v1`), for an owner or admin: move this server's
 * agents and server settings to or from an OpenBot transfer file. Each direction has its own page.
 */
export function ServerTransferScreen() {
  const { t } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { canTransferServer } = useMobileWorkspace();
  if (!canTransferServer(serverId))
    return (
      <SettingsContent>
        <SettingsNote>{t("mobile.server.transfer.unavailable")}</SettingsNote>
      </SettingsContent>
    );
  return (
    <SettingsContent>
      <SettingsNote>{t("mobile.server.transfer.lede")}</SettingsNote>
      <SettingsSection title={t("mobile.server.transfer.title")} footer={t("mobile.server.transfer.notMoved")}>
        <SettingsRow
          supportingText={t("mobile.server.transfer.exportNote")}
          onPress={() => router.push({ pathname: "/server-settings/transfer-export", params: { serverId } })}
        >
          <Typography.Paragraph>{t("mobile.server.transfer.export")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow
          supportingText={t("mobile.server.transfer.importNote")}
          onPress={() => router.push({ pathname: "/server-settings/transfer-import", params: { serverId } })}
        >
          <Typography.Paragraph>{t("mobile.server.transfer.import")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
    </SettingsContent>
  );
}
