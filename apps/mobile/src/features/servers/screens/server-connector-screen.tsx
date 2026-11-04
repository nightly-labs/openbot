import { Stack, useLocalSearchParams } from "expo-router";
import { BitwardenConnectorPage } from "@/features/servers/components/bitwarden-connector-page";
import { GitHubConnectorPage } from "@/features/servers/components/github-connector-page";
import { MessagingConnectorPage } from "@/features/servers/components/messaging-connector-page";
import { OnePasswordConnectorPage } from "@/features/servers/components/onepassword-connector-page";
import { WhatsAppConnectorPage } from "@/features/servers/components/whatsapp-connector-page";
import { CONNECTOR_TITLE_KEYS, isMobileConnectorId } from "@/features/servers/model/connectors";
import { useServerConnectors } from "@/features/servers/model/use-server-connectors";
import { SettingsContent, SettingsNote } from "@/features/settings/components/settings-content";
import { useText } from "@/shared/lib/text";

/** Marketplace › Apps › one connector of a joined server, for an owner or admin. */
export function ServerConnectorScreen() {
  const { t } = useText();
  const { serverId, id } = useLocalSearchParams<{ serverId: string; id: string }>();
  const {
    server,
    agents,
    connectors,
    onePasswordAvailable,
    bitwardenAvailable,
    whatsappAvailable,
    messaging,
    whatsapp,
    github,
    onePassword,
    bitwarden,
  } = useServerConnectors(serverId, isMobileConnectorId(id) ? id : null);
  const reachable =
    isMobileConnectorId(id) &&
    (id === "onepassword"
      ? onePasswordAvailable
      : id === "bitwarden"
        ? bitwardenAvailable
        : id === "whatsapp"
          ? whatsappAvailable
          : connectors);
  if (!server || !reachable)
    return (
      <SettingsContent>
        <SettingsNote>{t(server ? "mobile.server.connectors.unavailable" : "mobile.server.unavailable")}</SettingsNote>
      </SettingsContent>
    );
  return (
    <>
      <Stack.Screen options={{ title: t(CONNECTOR_TITLE_KEYS[id]) }} />
      {id === "github" ? (
        <GitHubConnectorPage server={server} query={github} />
      ) : id === "onepassword" ? (
        <OnePasswordConnectorPage server={server} query={onePassword} />
      ) : id === "bitwarden" ? (
        <BitwardenConnectorPage server={server} query={bitwarden} />
      ) : id === "whatsapp" ? (
        <WhatsAppConnectorPage server={server} query={whatsapp} agents={agents} />
      ) : (
        <MessagingConnectorPage server={server} platform={id} query={messaging[id]} agents={agents} />
      )}
    </>
  );
}
