// The Slack workspaces and Discord guilds where this computer's agents answer. Tokens only travel
// towards the host; no result carries one.

import { runCauseEffect } from "../../backend/effect-boundary";
import type { MessagingService } from "../../backend/messaging/messaging-service";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import {
  parseAddMessagingOrchestratorInput,
  parseMessagingWorkspaceInput,
  parseSetMessagingEnabledInput,
} from "./messaging-inputs";

interface MessagingIpcDependencies {
  messaging: Pick<
    MessagingService,
    | "slackOverview"
    | "connectSlackWorkspace"
    | "disconnectSlackWorkspace"
    | "discordOverview"
    | "connectDiscordGuild"
    | "disconnectDiscordGuild"
    | "reconnect"
    | "setEnabled"
    | "addOrchestrator"
  >;
}

export function messagingIpcHandlers({ messaging }: MessagingIpcDependencies): Pick<IpcGroupHandlers, "messaging"> {
  return {
    messaging: {
      getSlackOverview: handler(() => messaging.slackOverview()),
      connectSlackWorkspace: handler(() => runCauseEffect(messaging.connectSlackWorkspace())),
      disconnectSlackWorkspace: payloadHandler(parseMessagingWorkspaceInput, ({ workspaceId }) =>
        runCauseEffect(messaging.disconnectSlackWorkspace(workspaceId)),
      ),
      reconnectSlackWorkspace: payloadHandler(parseMessagingWorkspaceInput, ({ workspaceId }) =>
        runCauseEffect(messaging.reconnect("slack", workspaceId)),
      ),
      setSlackEnabled: payloadHandler(parseSetMessagingEnabledInput, ({ workspaceId, enabled }) =>
        runCauseEffect(messaging.setEnabled("slack", workspaceId, enabled)),
      ),
      addSlackOrchestrator: payloadHandler(parseAddMessagingOrchestratorInput, (input) =>
        runCauseEffect(messaging.addOrchestrator("slack", input)),
      ),
      getDiscordOverview: handler(() => messaging.discordOverview()),
      connectDiscordGuild: handler(() => runCauseEffect(messaging.connectDiscordGuild())),
      disconnectDiscordGuild: payloadHandler(parseMessagingWorkspaceInput, ({ workspaceId }) =>
        runCauseEffect(messaging.disconnectDiscordGuild(workspaceId)),
      ),
      reconnectDiscordGuild: payloadHandler(parseMessagingWorkspaceInput, ({ workspaceId }) =>
        runCauseEffect(messaging.reconnect("discord", workspaceId)),
      ),
      setDiscordEnabled: payloadHandler(parseSetMessagingEnabledInput, ({ workspaceId, enabled }) =>
        runCauseEffect(messaging.setEnabled("discord", workspaceId, enabled)),
      ),
      addDiscordOrchestrator: payloadHandler(parseAddMessagingOrchestratorInput, (input) =>
        runCauseEffect(messaging.addOrchestrator("discord", input)),
      ),
    },
  };
}
