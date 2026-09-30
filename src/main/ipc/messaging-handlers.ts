// The Slack connection of one agent. On a joined server the agent runs on the host, so the request
// goes there, and the host answers only an owner or admin. Tokens only travel towards the host; no
// result carries one.

import { decodeMessagingOverview, decodeMessagingThread } from "@openbot/contracts/ipc";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import { MESSAGING_CAPABILITY, MESSAGING_ROUTES } from "@openbot/contracts/team-protocol/messaging-v1";
import { sourceText } from "@openbot/i18n/source";
import type { MessagingService } from "../../backend/messaging/messaging-service";
import type { ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import { handler, type IpcGroupHandlers } from "./define-ipc-group";
import {
  parseCreateSlackAppInput,
  parseMessagingAgentInput,
  parseReadMessagingThreadInput,
  parseSetMessagingEnabledInput,
  parseSetSlackIconInput,
  parseSlackWorkspaceInput,
} from "./messaging-inputs";
import { scopedHandler } from "./scoped-handler";

interface MessagingRemoteServers {
  supportsCapability(serverId: string, capability: TeamCurrentCapability): boolean;
  request<T>(serverId: string, path: string, decoder: ResponseDecoder<T>, init?: RemoteRequestInit): Promise<T>;
}

interface MessagingIpcDependencies {
  messaging: Pick<
    MessagingService,
    | "overview"
    | "reconnect"
    | "setEnabled"
    | "disconnect"
    | "readThread"
    | "slackOverview"
    | "connectSlackWorkspace"
    | "disconnectSlackWorkspace"
    | "createSlackApp"
    | "openSlackInstall"
    | "setSlackIcon"
  >;
  remoteServers: MessagingRemoteServers;
}

export function messagingIpcHandlers({
  messaging,
  remoteServers,
}: MessagingIpcDependencies): Pick<IpcGroupHandlers, "messaging"> {
  function remote<T>(serverId: string, path: string, body: unknown, decoder: ResponseDecoder<T>): Promise<T> {
    if (!remoteServers.supportsCapability(serverId, MESSAGING_CAPABILITY))
      throw new Error(sourceText("error.messaging.unsupported"));
    return remoteServers.request(serverId, path, decoder, { method: "POST", body });
  }

  function hostOnly(): never {
    throw new Error(sourceText("error.messaging.managedOnHost"));
  }

  return {
    messaging: {
      getOverview: scopedHandler(parseMessagingAgentInput, {
        local: ({ agentId }) => messaging.overview(agentId),
        remote: (input, serverId) => remote(serverId, MESSAGING_ROUTES.overview, input, decodeMessagingOverview),
      }),
      reconnect: scopedHandler(parseMessagingAgentInput, {
        local: ({ agentId }) => messaging.reconnect(agentId),
        remote: (input, serverId) => remote(serverId, MESSAGING_ROUTES.reconnect, input, decodeMessagingOverview),
      }),
      setEnabled: scopedHandler(parseSetMessagingEnabledInput, {
        local: ({ agentId, enabled }) => messaging.setEnabled(agentId, enabled),
        remote: (input, serverId) => remote(serverId, MESSAGING_ROUTES.setEnabled, input, decodeMessagingOverview),
      }),
      disconnect: scopedHandler(parseMessagingAgentInput, {
        local: ({ agentId }) => messaging.disconnect(agentId),
        remote: (input, serverId) => remote(serverId, MESSAGING_ROUTES.disconnect, input, decodeMessagingOverview),
      }),
      readThread: scopedHandler(parseReadMessagingThreadInput, {
        local: ({ agentId, linkId }) => messaging.readThread(agentId, linkId),
        remote: (input, serverId) => remote(serverId, MESSAGING_ROUTES.thread, input, decodeMessagingThread),
      }),
      // The workspaces and the Slack apps are this computer's: these two have no server to name.
      getSlackOverview: handler(() => messaging.slackOverview()),
      connectSlackWorkspace: handler(() => messaging.connectSlackWorkspace()),
      disconnectSlackWorkspace: scopedHandler(parseSlackWorkspaceInput, {
        local: ({ workspaceId }) => messaging.disconnectSlackWorkspace(workspaceId),
        remote: hostOnly,
      }),
      createSlackApp: scopedHandler(parseCreateSlackAppInput, {
        local: (input) => messaging.createSlackApp(input),
        remote: hostOnly,
      }),
      openSlackInstall: scopedHandler(parseMessagingAgentInput, {
        local: ({ agentId }) => messaging.openSlackInstall(agentId),
        remote: hostOnly,
      }),
      setSlackIcon: scopedHandler(parseSetSlackIconInput, {
        local: ({ agentId, image }) => messaging.setSlackIcon(agentId, image.bytes),
        remote: hostOnly,
      }),
    },
  };
}
