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

export function ServerTransferScreen() {
  const { t } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { servers, canTransferServer } = useMobileWorkspace();
  if (!canTransferServer(serverId))
    return (
      <SettingsContent>
        <SettingsNote>{t("mobile.server.transfer.unavailable")}</SettingsNote>
      </SettingsContent>
    );
  const canCopy = servers.some((server) => server.id !== serverId && canTransferServer(server.id));
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
        {canCopy ? (
          <SettingsRow
            supportingText={t("mobile.server.transfer.copyNote")}
            onPress={() => router.push({ pathname: "/server-settings/transfer-copy", params: { serverId } })}
          >
            <Typography.Paragraph>{t("mobile.server.transfer.copy")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
    </SettingsContent>
  );
}
