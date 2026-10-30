import type { MessagingConnection, MessagingPlatform } from "@openbot/contracts/ipc";
import { router, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { ConnectorLogo } from "@/features/servers/components/connector-logo";
import { TrailingValue } from "@/features/servers/components/trailing-value";
import {
  attentionCount,
  CONNECTOR_STATUS_KEYS,
  CONNECTOR_TITLE_KEYS,
  type ConnectorStatus,
  MESSAGING_TEXT,
  MOBILE_CONNECTOR_IDS,
  type MobileConnectorId,
  messagingStatus,
  telegramOrchestrator,
  workspaceOrchestrator,
} from "@/features/servers/model/connectors";
import { useServerConnectors } from "@/features/servers/model/use-server-connectors";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { type MobileText, useText } from "@/shared/lib/text";

/** What the list shows for one connector. A connector that the server cannot run has no row. */
interface ConnectorRow {
  id: MobileConnectorId;
  status: ConnectorStatus;
  statusLabel: string;
  summary: string;
}

function messagingSummary(
  { t }: MobileText,
  platform: MessagingPlatform,
  connections: readonly MessagingConnection[],
  agents: readonly MobileAgent[],
): string {
  const attention = attentionCount(platform, connections, agents);
  if (platform === "telegram") {
    const count = connections.length;
    if (attention > 0) return t("mobile.server.connectors.telegram.attention", { count: attention });
    if (count === 0) return t("mobile.server.connectors.telegram.summary");
    return telegramOrchestrator(connections, agents)
      ? t("mobile.server.connectors.telegram.connected", { count })
      : t("mobile.server.connectors.telegram.noAgent", { count });
  }
  const text = MESSAGING_TEXT[platform];
  if (attention > 0) return t(text.attention, { count: attention });
  const [connection, ...others] = connections;
  if (!connection) return t(text.summary);
  if (others.length > 0) return t(text.many, { count: connections.length });
  const workspace = connection.workspaceName;
  return workspaceOrchestrator(connection, agents) ? t(text.connected, { workspace }) : t(text.noAgent, { workspace });
}

/**
 * Server settings › Connectors: the connectors of a joined server, for an owner or admin. A row that
 * is set up sorts into the first section with its status; the others wait below. A host without
 * `bitwarden-connector-v1` connects Bitwarden only on its own computer, so it shows with no action.
 */
export function ServerConnectorsScreen() {
  const text = useText();
  const { t } = text;
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const {
    server,
    agents,
    connectors,
    onePasswordAvailable,
    bitwardenAvailable,
    messaging,
    github,
    onePassword,
    bitwarden,
  } = useServerConnectors(serverId, "all");
  if (!server || !(connectors || onePasswordAvailable || bitwardenAvailable))
    return (
      <SettingsContent>
        <SettingsNote>{t(server ? "mobile.server.connectors.unavailable" : "mobile.server.unavailable")}</SettingsNote>
      </SettingsContent>
    );

  const unknown = (id: MobileConnectorId): ConnectorRow => ({
    id,
    status: "unknown",
    statusLabel: t(CONNECTOR_STATUS_KEYS.unknown),
    summary: t("mobile.server.connectors.readFailed"),
  });
  const row = (id: MobileConnectorId): ConnectorRow[] => {
    if (id === "bitwarden") {
      if (!bitwardenAvailable)
        return [
          {
            id,
            status: "unavailable",
            statusLabel: t(CONNECTOR_STATUS_KEYS.unavailable),
            summary: t("mobile.server.connectors.bitwarden.summary"),
          },
        ];
      const status = bitwarden.data;
      if (!status) return bitwarden.isError ? [unknown(id)] : [];
      const state: ConnectorStatus = status.connecting ? "connecting" : status.connected ? "connected" : "idle";
      return [
        {
          id,
          status: state,
          statusLabel: t(CONNECTOR_STATUS_KEYS[state]),
          summary:
            status.connected && status.serverUrl
              ? status.serverUrl
              : t("mobile.server.connectors.bitwarden.hostSummary"),
        },
      ];
    }
    if (id === "github") {
      if (!connectors) return [];
      const status = github.data;
      if (!status) return github.isError ? [unknown(id)] : [];
      // A host with no GitHub App cannot connect GitHub. The desktop hides it too.
      if (!status.available) return [];
      const state: ConnectorStatus =
        status.state === "connected"
          ? "connected"
          : status.state === "pending"
            ? "connecting"
            : status.state === "expired"
              ? "attention"
              : "idle";
      return [
        {
          id,
          status: state,
          statusLabel: t(
            status.state === "expired" ? "mobile.server.connectors.statusExpired" : CONNECTOR_STATUS_KEYS[state],
          ),
          summary:
            status.state === "connected"
              ? `@${status.login ?? ""}`
              : status.state === "expired"
                ? t("mobile.server.connectors.github.expired")
                : t("mobile.server.connectors.github.summary"),
        },
      ];
    }
    if (id === "onepassword") {
      if (!onePasswordAvailable) return [];
      const status = onePassword.data;
      if (!status) return onePassword.isError ? [unknown(id)] : [];
      const state: ConnectorStatus =
        status.state === "connected" ? "connected" : status.state === "disconnected" ? "idle" : "connecting";
      return [
        {
          id,
          status: state,
          statusLabel: t(CONNECTOR_STATUS_KEYS[state]),
          summary:
            status.state === "connected" && status.loginCount !== null
              ? t("mobile.server.connectors.onePassword.loginCount", { count: status.loginCount })
              : t("mobile.server.connectors.onePassword.summary"),
        },
      ];
    }
    if (!connectors) return [];
    const query = messaging[id];
    const connections = query.data?.connections;
    if (!connections) return query.isError ? [unknown(id)] : [];
    const state = messagingStatus(id, connections, agents);
    return [
      {
        id,
        status: state,
        statusLabel: t(CONNECTOR_STATUS_KEYS[state]),
        summary: messagingSummary(text, id, connections, agents),
      },
    ];
  };
  const rows = MOBILE_CONNECTOR_IDS.flatMap(row);
  const waits = (item: ConnectorRow) => item.status === "idle" || item.status === "unavailable";
  const active = rows.filter((item) => !waits(item));
  const idle = rows.filter(waits);
  const loading = [messaging.slack, messaging.discord, messaging.telegram, github, onePassword, bitwarden].some(
    (query) => query.isLoading,
  );
  const item = (entry: ConnectorRow) => (
    <SettingsRow
      key={entry.id}
      leading={<ConnectorLogo id={entry.id} />}
      supportingText={entry.summary}
      disclosure={entry.status !== "unavailable"}
      trailing={
        entry.status === "unavailable" ? (
          <Typography.Paragraph type="body-xs" className="text-grouped-secondary">
            {entry.statusLabel}
          </Typography.Paragraph>
        ) : entry.status === "idle" ? undefined : (
          <TrailingValue
            value={entry.statusLabel}
            tone={entry.status === "attention" || entry.status === "unknown" ? "warning" : undefined}
          />
        )
      }
      onPress={
        entry.status === "unavailable"
          ? undefined
          : () => router.push({ pathname: "/server-settings/connector", params: { serverId, id: entry.id } })
      }
    >
      <Typography.Paragraph>{t(CONNECTOR_TITLE_KEYS[entry.id])}</Typography.Paragraph>
    </SettingsRow>
  );
  return (
    <SettingsContent>
      {loading ? <SettingsNote>{t("mobile.server.connectors.loading")}</SettingsNote> : null}
      {active.length > 0 ? (
        <SettingsSection title={t("mobile.server.connectors.onServer", { name: server.name })}>
          {active.map(item)}
        </SettingsSection>
      ) : null}
      {!loading && idle.length > 0 ? (
        <SettingsSection
          title={t(active.length > 0 ? "mobile.server.connectors.notSetUp" : "mobile.server.connectors.available")}
        >
          {idle.map(item)}
        </SettingsSection>
      ) : null}
    </SettingsContent>
  );
}
