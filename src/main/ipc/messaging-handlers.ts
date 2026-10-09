// The Slack workspaces, Discord guilds and Telegram chats where this computer's agents answer. Tokens
// only travel towards the host; no result carries one.

import { runCauseEffect } from "../../backend/effect-boundary";
import type { MessagingService } from "../../backend/messaging/messaging-service";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import {
  parseAddMessagingOrchestratorInput,
  parseAddTelegramOrchestratorInput,
  parseConnectTelegramChatInput,
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
    | "telegramOverview"
    | "connectTelegramChat"
    | "disconnectTelegramChat"
    | "addTelegramOrchestrator"
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
      getTelegramOverview: handler(() => messaging.telegramOverview()),
      connectTelegramChat: payloadHandler(parseConnectTelegramChatInput, ({ place }) =>
        runCauseEffect(messaging.connectTelegramChat(place)),
      ),
      disconnectTelegramChat: payloadHandler(parseMessagingWorkspaceInput, ({ workspaceId }) =>
        runCauseEffect(messaging.disconnectTelegramChat(workspaceId)),
      ),
      reconnectTelegramChat: payloadHandler(parseMessagingWorkspaceInput, ({ workspaceId }) =>
        runCauseEffect(messaging.reconnect("telegram", workspaceId)),
      ),
      setTelegramEnabled: payloadHandler(parseSetMessagingEnabledInput, ({ workspaceId, enabled }) =>
        runCauseEffect(messaging.setEnabled("telegram", workspaceId, enabled)),
      ),
      addTelegramOrchestrator: payloadHandler(parseAddTelegramOrchestratorInput, (input) =>
        runCauseEffect(messaging.addTelegramOrchestrator(input)),
      ),
    },
  };
}
