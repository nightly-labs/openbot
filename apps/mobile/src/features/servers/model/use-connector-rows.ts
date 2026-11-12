import { useMemo } from "react";
import {
  type ConnectorStatus,
  MOBILE_CONNECTOR_IDS,
  type MobileConnectorId,
  messagingStatus,
  whatsappStatus,
} from "@/features/servers/model/connectors";
import { passwordManagerConnectorStatus } from "@/features/servers/model/password-managers";
import { useServerConnectors } from "@/features/servers/model/use-server-connectors";

/** The status of one connector. A connector that the server cannot run has no row. */
export interface ConnectorRow {
  id: MobileConnectorId;
  status: ConnectorStatus;
}

/**
 * The connectors of a joined server with the status of each, for an owner or admin: the Apps of the
 * Marketplace show them. A host without `bitwarden-connector-v1` connects Bitwarden only on its own
 * computer, so its row is `unavailable`.
 */
export function useConnectorRows(serverId: string): ConnectorRow[] {
  return useConnectorRowState(serverId).rows;
}

/**
 * The rows, and the connectors that have no row yet because their status still loads. A connector that
 * is in neither list cannot run on the host, or the user cannot manage it.
 */
export function useConnectorRowState(serverId: string): { rows: ConnectorRow[]; loading: MobileConnectorId[] } {
  const {
    agents,
    connectors,
    onePasswordAvailable,
    bitwardenAvailable,
    whatsappAvailable,
    passwordManagersAvailable,
    messaging,
    whatsapp,
    github,
    onePassword,
    bitwarden,
    passwordManagers,
  } = useServerConnectors(serverId, null);
  const { data: slackData, isError: slackError } = messaging.slack;
  const { data: discordData, isError: discordError } = messaging.discord;
  const { data: telegramData, isError: telegramError } = messaging.telegram;
  const { data: whatsappData, isError: whatsappError } = whatsapp;
  const { data: githubData, isError: githubError } = github;
  const { data: onePasswordData, isError: onePasswordError } = onePassword;
  const { data: bitwardenData, isError: bitwardenError } = bitwarden;
  const { data: passwordManagersData, isError: passwordManagersError } = passwordManagers;

  // The query data keeps its reference while it does not change, so the Marketplace listings stay cached.
  return useMemo(() => {
    const loading: MobileConnectorId[] = [];
    const failed = (id: MobileConnectorId, isError: boolean): ConnectorRow[] => {
      if (isError) return [{ id, status: "unknown" }];
      loading.push(id);
      return [];
    };
    const row = (id: MobileConnectorId): ConnectorRow[] => {
      if (id === "bitwarden") {
        if (!bitwardenAvailable) return [{ id, status: "unavailable" }];
        const status = bitwardenData;
        if (!status) return failed(id, bitwardenError);
        return [{ id, status: status.connecting ? "connecting" : status.connected ? "connected" : "idle" }];
      }
      if (id === "protonpass") {
        // A host lists only the managers that it can connect, so a manager that it does not list has no row.
        if (!passwordManagersAvailable) return [];
        if (!passwordManagersData) return failed(id, passwordManagersError);
        const status = passwordManagersData.find((candidate) => candidate.manager === id);
        return status ? [{ id, status: passwordManagerConnectorStatus(status, Date.now()) }] : [];
      }
      if (id === "whatsapp") {
        if (!whatsappAvailable) return [];
        const connections = whatsappData?.connections;
        if (!connections) return failed(id, whatsappError);
        return [{ id, status: whatsappStatus(connections, agents) }];
      }
      if (id === "github") {
        if (!connectors) return [];
        const status = githubData;
        if (!status) return failed(id, githubError);
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
        return [{ id, status: state }];
      }
      if (id === "onepassword") {
        if (!onePasswordAvailable) return [];
        const status = onePasswordData;
        if (!status) return failed(id, onePasswordError);
        const state: ConnectorStatus =
          status.state === "connected" ? "connected" : status.state === "disconnected" ? "idle" : "connecting";
        return [{ id, status: state }];
      }
      if (!connectors) return [];
      const [data, isError] =
        id === "slack"
          ? [slackData, slackError]
          : id === "discord"
            ? [discordData, discordError]
            : [telegramData, telegramError];
      const connections = data?.connections;
      if (!connections) return failed(id, isError);
      return [{ id, status: messagingStatus(id, connections, agents) }];
    };
    return { rows: MOBILE_CONNECTOR_IDS.flatMap(row), loading };
  }, [
    agents,
    connectors,
    onePasswordAvailable,
    bitwardenAvailable,
    whatsappAvailable,
    passwordManagersAvailable,
    slackData,
    slackError,
    discordData,
    discordError,
    telegramData,
    telegramError,
    whatsappData,
    whatsappError,
    githubData,
    githubError,
    onePasswordData,
    onePasswordError,
    bitwardenData,
    bitwardenError,
    passwordManagersData,
    passwordManagersError,
  ]);
}
