// The `messaging-v1` requests to one host: the Slack connection of an agent. The desktop sends the
// same routes from the main process; the web client sends them through its own transport. The host
// answers only an owner or admin. No request or reply carries a token.

import { decodeMessagingOverview, decodeMessagingThread, type MessagingDesktopApi } from "@openbot/contracts/ipc";
import { MESSAGING_ROUTES } from "@openbot/contracts/team-protocol/messaging-v1";
import { sourceText } from "@openbot/i18n/source";
import type { TeamApiRequest } from "./team-api-requests";

/** The desktop `messaging` group, answered over the Team API of a host. */
export function teamMessagingRequests(request: (serverId?: string) => TeamApiRequest): MessagingDesktopApi {
  return {
    getOverview: async ({ agentId }, serverId) =>
      request(serverId)("POST", MESSAGING_ROUTES.overview, decodeMessagingOverview, { agentId }),
    reconnect: async ({ agentId }, serverId) =>
      request(serverId)("POST", MESSAGING_ROUTES.reconnect, decodeMessagingOverview, { agentId }),
    setEnabled: async ({ agentId, enabled }, serverId) =>
      request(serverId)("POST", MESSAGING_ROUTES.setEnabled, decodeMessagingOverview, { agentId, enabled }),
    disconnect: async ({ agentId }, serverId) =>
      request(serverId)("POST", MESSAGING_ROUTES.disconnect, decodeMessagingOverview, { agentId }),
    readThread: async ({ agentId, linkId }, serverId) =>
      request(serverId)("POST", MESSAGING_ROUTES.thread, decodeMessagingThread, { agentId, linkId }),
    // A managed Slack app opens Slack in the host's own browser, so no route creates one.
    getSlackOverview: hostOnly,
    connectSlackWorkspace: hostOnly,
    disconnectSlackWorkspace: hostOnly,
    createSlackApp: hostOnly,
    openSlackInstall: hostOnly,
    setSlackIcon: hostOnly,
  };
}

async function hostOnly(): Promise<never> {
  throw new Error(sourceText("error.messaging.managedOnHost"));
}
