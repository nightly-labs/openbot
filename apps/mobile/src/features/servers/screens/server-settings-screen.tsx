import { router, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useRef, useState } from "react";
import { Alert } from "react-native";
import { ServerStatusLabel } from "@/features/servers/components/server-status-label";
import { SERVER_ROLE_KEYS } from "@/features/servers/model/server-role";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { useText } from "@/shared/lib/text";

export function ServerSettingsScreen() {
  const { t, sourceText } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { servers, leaveServer, refreshServer } = useMobileWorkspace();
  const server = servers.find((item) => item.id === serverId);
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function perform(operation: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      await operation();
    } catch {
      setError(t("mobile.server.settings.updateFailed"));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  if (!server)
    return (
      <SettingsContent>
        <SettingsNote>{t("mobile.server.unavailable")}</SettingsNote>
      </SettingsContent>
    );
  return (
    <SettingsContent>
      <SettingsSection title={server.name}>
        <SettingsRow
          disclosure={false}
          supportingText={t("mobile.server.settings.role", { role: t(SERVER_ROLE_KEYS[server.role]) })}
        >
          <ServerStatusLabel server={server} />
        </SettingsRow>
        {server.connectionMessage ? <SettingsNote>{sourceText(server.connectionMessage)}</SettingsNote> : null}
        <SettingsRow onPress={() => router.push({ pathname: "/server-settings/members", params: { serverId } })}>
          <Typography.Paragraph type="body-sm">{t("mobile.server.settings.members")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow disclosure={false} disabled={busy} onPress={() => void perform(() => refreshServer(serverId))}>
          <Typography.Paragraph type="body-sm">
            {busy ? t("mobile.server.settings.refreshing") : t("mobile.server.settings.refresh")}
          </Typography.Paragraph>
        </SettingsRow>
        {server.role !== "owner" ? (
          <SettingsRow
            disclosure={false}
            disabled={busy}
            onPress={() =>
              Alert.alert(
                t("mobile.server.settings.leaveTitle", { name: server.name }),
                t("mobile.server.settings.leaveBody"),
                [
                  { text: t("common.cancel"), style: "cancel" },
                  {
                    text: t("mobile.server.settings.leave"),
                    style: "destructive",
                    onPress: () =>
                      void perform(async () => {
                        await leaveServer(serverId);
                        router.dismiss();
                      }),
                  },
                ],
              )
            }
          >
            <Typography.Paragraph type="body-sm" className="text-danger-text">
              {t("mobile.server.settings.leave")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {error ? <SettingsNote>{error}</SettingsNote> : null}
      </SettingsSection>
    </SettingsContent>
  );
}
