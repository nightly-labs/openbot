import { useLocalSearchParams } from "expo-router";
import { ServerAgentsSection, useAgentSettingsAvailable } from "@/features/servers/screens/server-settings-sections";
import { SettingsContent, SettingsNote } from "@/features/settings/components/settings-content";
import { useText } from "@/shared/lib/text";

export function ServerAgentsScreen() {
  const { t } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const available = useAgentSettingsAvailable(serverId);
  return (
    <SettingsContent>
      {available ? (
        <ServerAgentsSection serverId={serverId} />
      ) : (
        <SettingsNote>{t("mobile.server.settings.agentsUnavailable")}</SettingsNote>
      )}
    </SettingsContent>
  );
}
