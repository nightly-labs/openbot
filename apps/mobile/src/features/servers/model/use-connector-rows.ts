import type { ConnectorMessagingPlatform, MessagingConnection } from "@openbot/contracts/ipc";
import {
  attentionCount,
  CONNECTOR_STATUS_KEYS,
  type ConnectorStatus,
  MESSAGING_TEXT,
  MOBILE_CONNECTOR_IDS,
  type MobileConnectorId,
  messagingStatus,
  telegramOrchestrator,
  whatsappAttentionCount,
  whatsappStatus,
  workspaceOrchestrator,
} from "@/features/servers/model/connectors";
import { useServerConnectors } from "@/features/servers/model/use-server-connectors";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { type MobileText, useText } from "@/shared/lib/text";

/** What a list shows for one connector. A connector that the server cannot run has no row. */
export interface ConnectorRow {
  id: MobileConnectorId;
  status: ConnectorStatus;
  statusLabel: string;
  summary: string;
}

function messagingSummary(
  { t }: MobileText,
  platform: ConnectorMessagingPlatform,
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

/** As the desktop WhatsApp row: the numbers that need the user, then the numbers and their orchestrator. */
function whatsappSummary(
  { t }: MobileText,
  connections: readonly MessagingConnection[],
  agents: readonly MobileAgent[],
): string {
  const count = connections.length;
  const attention = whatsappAttentionCount(connections, agents);
  if (attention > 0) return t("mobile.server.connectors.whatsapp.attention", { count: attention });
  if (count === 0) return t("mobile.server.connectors.whatsapp.summary");
  return telegramOrchestrator(connections, agents)
    ? t("mobile.server.connectors.whatsapp.connected", { count })
    : t("mobile.server.connectors.whatsapp.noAgent", { count });
}

/**
 * The connectors of a joined server with the status of each, for an owner or admin: Server settings ›
 * Connectors and the Apps of the Marketplace show the same rows. A host without `bitwarden-connector-v1`
 * connects Bitwarden only on its own computer, so its row is `unavailable`.
 */
export function useConnectorRows(serverId: string, poll: MobileConnectorId | "all" | null) {
  const text = useText();
  const { t } = text;
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
  } = useServerConnectors(serverId, poll);

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
    if (id === "whatsapp") {
      if (!whatsappAvailable) return [];
      const connections = whatsapp.data?.connections;
      if (!connections) return whatsapp.isError ? [unknown(id)] : [];
      const state = whatsappStatus(connections, agents);
      return [
        {
          id,
          status: state,
          statusLabel: t(CONNECTOR_STATUS_KEYS[state]),
          summary: whatsappSummary(text, connections, agents),
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
  return {
    server,
    /** The server runs at least one connector that a phone can set up or show. */
    available: connectors || onePasswordAvailable || bitwardenAvailable || whatsappAvailable,
    rows: MOBILE_CONNECTOR_IDS.flatMap(row),
    loading: [messaging.slack, messaging.discord, messaging.telegram, whatsapp, github, onePassword, bitwarden].some(
      (query) => query.isLoading,
    ),
  };
}
