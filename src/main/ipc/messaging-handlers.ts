// The Slack workspaces, Discord guilds and Telegram chats where this computer's agents answer. Tokens
// only travel towards the host; no result carries one. The `host*` endpoints do the same for a
// joined server (`connectors-v1`).

import {
  type AddMessagingOrchestratorResult,
  type DiscordAccess,
  type DiscordRoleList,
  decodeHostMessagingOverview,
  isAddMessagingOrchestratorResult,
  isDiscordAccess,
  isDiscordRoleList,
  type MessagingPlatform,
  messagingPage,
} from "@openbot/contracts/ipc";
import { decodeRecord, nullableString } from "@openbot/contracts/ipc-decoding";
import { CONNECTORS_CAPABILITY, CONNECTORS_ROUTES } from "@openbot/contracts/team-protocol/connectors-v1";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import { DISCORD_ACCESS_CAPABILITY, DISCORD_ACCESS_ROUTES } from "@openbot/contracts/team-protocol/discord-access-v1";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { MessagingService } from "../../backend/messaging/messaging-service";
import type { RelayedMessagingInstalls } from "../relayed-messaging-installs";
import type { ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import type { RemoteWorkflowError } from "../remote-service-effects";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import {
  parseAddMessagingOrchestratorInput,
  parseAddTelegramOrchestratorInput,
  parseConnectTelegramChatInput,
  parseHostAddMessagingOrchestratorInput,
  parseHostMessagingConnectInput,
  parseHostMessagingPlatformInput,
  parseHostMessagingWorkspaceInput,
  parseHostSetMessagingEnabledInput,
  parseMessagingWorkspaceInput,
  parseSetDiscordAccessInput,
  parseSetMessagingEnabledInput,
} from "./messaging-inputs";
import { scopedHandler } from "./scoped-handler";

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
    | "discordAccess"
    | "listDiscordRoles"
    | "setDiscordAccess"
  >;
  remoteServers: {
    supportsCapability(serverId: string, capability: TeamCurrentCapability): boolean;
    request<T>(
      serverId: string,
      path: string,
      decoder: ResponseDecoder<T>,
      init?: RemoteRequestInit,
    ): Effect.Effect<T, RemoteWorkflowError>;
  };
  relayedInstalls: Pick<RelayedMessagingInstalls, "remember">;
  /** Opens a joined server's connect page in this computer's browser. */
  openExternal: (url: string) => Promise<void>;
}

/** `url` is null when a reconnect needs no page. */
const decodePage = (value: unknown): { url: string | null; nonce: string | null } => {
  const record = decodeRecord(value, "messaging page");
  return { url: nullableString(record, "url"), nonce: nullableString(record, "nonce") };
};

const decodeEmpty = (): null => null;

const decodeDiscordAccess = (value: unknown): DiscordAccess => {
  if (!isDiscordAccess(value)) throw new Error("Invalid Discord access response.");
  return value;
};

const decodeDiscordRoles = (value: unknown): DiscordRoleList => {
  if (!isDiscordRoleList(value)) throw new Error("Invalid Discord roles response.");
  return value;
};

const decodeOrchestrator = (value: unknown): AddMessagingOrchestratorResult => {
  if (!isAddMessagingOrchestratorResult(value)) throw new Error("Invalid messaging orchestrator response.");
  return value;
};

export function messagingIpcHandlers({
  messaging,
  remoteServers,
  relayedInstalls,
  openExternal,
}: MessagingIpcDependencies): Pick<IpcGroupHandlers, "messaging"> {
  function post<T>(serverId: string, path: string, decoder: ResponseDecoder<T>, body: TeamProtocolV2Json): Promise<T> {
    if (!remoteServers.supportsCapability(serverId, CONNECTORS_CAPABILITY))
      throw new Error(sourceText("error.team.connectorsUnsupported"));
    return runCauseEffect(remoteServers.request(serverId, path, decoder, { method: "POST", body }));
  }
  /** A `discord-access-v1` request to a joined server. An older host does not offer it. */
  function postAccess<T>(serverId: string, path: string, decoder: ResponseDecoder<T>, body: TeamProtocolV2Json) {
    if (!remoteServers.supportsCapability(serverId, DISCORD_ACCESS_CAPABILITY))
      throw new Error(sourceText("error.team.discordAccessUnsupported"));
    return runCauseEffect(remoteServers.request(serverId, path, decoder, { method: "POST", body }));
  }
  /**
   * Opens the page that a joined server named, when it is the platform's own page. A Slack or Discord
   * install returns here, so main keeps its nonce to send the grant on to that server.
   */
  async function open(
    serverId: string,
    platform: MessagingPlatform,
    page: { url: string | null; nonce: string | null },
  ) {
    if (page.url === null) return;
    const address = messagingPage(platform, page.url);
    if (!address) throw new Error(sourceText("error.team.connectorPageRefused"));
    if (platform !== "telegram" && page.nonce !== null) relayedInstalls.remember(platform, page.nonce, serverId);
    await openExternal(address);
  }
  const overview = (platform: MessagingPlatform) =>
    platform === "slack"
      ? messaging.slackOverview()
      : platform === "discord"
        ? messaging.discordOverview()
        : messaging.telegramOverview();

  return {
    messaging: {
      getSlackOverview: handler(() => messaging.slackOverview()),
      connectSlackWorkspace: handler(() => runCauseEffect(Effect.asVoid(messaging.connectSlackWorkspace(true)))),
      disconnectSlackWorkspace: payloadHandler(parseMessagingWorkspaceInput, ({ workspaceId }) =>
        runCauseEffect(messaging.disconnectSlackWorkspace(workspaceId)),
      ),
      reconnectSlackWorkspace: payloadHandler(parseMessagingWorkspaceInput, ({ workspaceId }) =>
        runCauseEffect(Effect.asVoid(messaging.reconnect("slack", workspaceId, true))),
      ),
      setSlackEnabled: payloadHandler(parseSetMessagingEnabledInput, ({ workspaceId, enabled }) =>
        runCauseEffect(messaging.setEnabled("slack", workspaceId, enabled)),
      ),
      addSlackOrchestrator: payloadHandler(parseAddMessagingOrchestratorInput, (input) =>
        runCauseEffect(messaging.addOrchestrator("slack", input)),
      ),
      getDiscordOverview: handler(() => messaging.discordOverview()),
      connectDiscordGuild: handler(() => runCauseEffect(Effect.asVoid(messaging.connectDiscordGuild(true)))),
      disconnectDiscordGuild: payloadHandler(parseMessagingWorkspaceInput, ({ workspaceId }) =>
        runCauseEffect(messaging.disconnectDiscordGuild(workspaceId)),
      ),
      reconnectDiscordGuild: payloadHandler(parseMessagingWorkspaceInput, ({ workspaceId }) =>
        runCauseEffect(Effect.asVoid(messaging.reconnect("discord", workspaceId, true))),
      ),
      setDiscordEnabled: payloadHandler(parseSetMessagingEnabledInput, ({ workspaceId, enabled }) =>
        runCauseEffect(messaging.setEnabled("discord", workspaceId, enabled)),
      ),
      addDiscordOrchestrator: payloadHandler(parseAddMessagingOrchestratorInput, (input) =>
        runCauseEffect(messaging.addOrchestrator("discord", input)),
      ),
      getDiscordAccess: payloadHandler(parseMessagingWorkspaceInput, ({ workspaceId }) =>
        runCauseEffect(messaging.discordAccess(workspaceId)),
      ),
      listDiscordRoles: payloadHandler(parseMessagingWorkspaceInput, ({ workspaceId }) =>
        runCauseEffect(messaging.listDiscordRoles(workspaceId)),
      ),
      setDiscordAccess: payloadHandler(parseSetDiscordAccessInput, (input) =>
        runCauseEffect(messaging.setDiscordAccess(input)),
      ),
      getTelegramOverview: handler(() => messaging.telegramOverview()),
      connectTelegramChat: payloadHandler(parseConnectTelegramChatInput, ({ place }) =>
        runCauseEffect(Effect.asVoid(messaging.connectTelegramChat(place, true))),
      ),
      disconnectTelegramChat: payloadHandler(parseMessagingWorkspaceInput, ({ workspaceId }) =>
        runCauseEffect(messaging.disconnectTelegramChat(workspaceId)),
      ),
      reconnectTelegramChat: payloadHandler(parseMessagingWorkspaceInput, ({ workspaceId }) =>
        runCauseEffect(Effect.asVoid(messaging.reconnect("telegram", workspaceId, true))),
      ),
      setTelegramEnabled: payloadHandler(parseSetMessagingEnabledInput, ({ workspaceId, enabled }) =>
        runCauseEffect(messaging.setEnabled("telegram", workspaceId, enabled)),
      ),
      addTelegramOrchestrator: payloadHandler(parseAddTelegramOrchestratorInput, (input) =>
        runCauseEffect(messaging.addTelegramOrchestrator(input)),
      ),
      hostOverview: scopedHandler(parseHostMessagingPlatformInput, {
        local: ({ platform }) => overview(platform),
        remote: ({ platform }, serverId) =>
          post(serverId, CONNECTORS_ROUTES.messagingOverview, decodeHostMessagingOverview, { platform }),
      }),
      hostConnect: scopedHandler(parseHostMessagingConnectInput, {
        local: ({ platform, place }) =>
          runCauseEffect(
            Effect.asVoid(
              platform === "slack"
                ? messaging.connectSlackWorkspace(true)
                : platform === "discord"
                  ? messaging.connectDiscordGuild(true)
                  : messaging.connectTelegramChat(place ?? "group", true),
            ),
          ),
        remote: async ({ platform, place }, serverId) =>
          open(
            serverId,
            platform,
            await post(serverId, CONNECTORS_ROUTES.messagingConnect, decodePage, { platform, place }),
          ),
      }),
      hostDisconnect: scopedHandler(parseHostMessagingWorkspaceInput, {
        local: ({ platform, workspaceId }) =>
          runCauseEffect(
            platform === "slack"
              ? messaging.disconnectSlackWorkspace(workspaceId)
              : platform === "discord"
                ? messaging.disconnectDiscordGuild(workspaceId)
                : messaging.disconnectTelegramChat(workspaceId),
          ),
        remote: async ({ platform, workspaceId }, serverId) => {
          await post(serverId, CONNECTORS_ROUTES.messagingDisconnect, decodeEmpty, { platform, workspaceId });
        },
      }),
      // A Discord server that removed the bot installs it again, so the host can answer a page.
      hostReconnect: scopedHandler(parseHostMessagingWorkspaceInput, {
        local: ({ platform, workspaceId }) =>
          runCauseEffect(Effect.asVoid(messaging.reconnect(platform, workspaceId, true))),
        remote: async ({ platform, workspaceId }, serverId) =>
          open(
            serverId,
            platform,
            await post(serverId, CONNECTORS_ROUTES.messagingReconnect, decodePage, { platform, workspaceId }),
          ),
      }),
      hostSetEnabled: scopedHandler(parseHostSetMessagingEnabledInput, {
        local: ({ platform, workspaceId, enabled }) =>
          runCauseEffect(messaging.setEnabled(platform, workspaceId, enabled)),
        remote: async ({ platform, workspaceId, enabled }, serverId) => {
          await post(serverId, CONNECTORS_ROUTES.messagingEnabled, decodeEmpty, { platform, workspaceId, enabled });
        },
      }),
      // A joined server's orchestrator starts on the host's default provider and model.
      hostAddOrchestrator: scopedHandler(parseHostAddMessagingOrchestratorInput, {
        local: ({ platform, workspaceId }) =>
          runCauseEffect(
            platform === "telegram" || workspaceId === null
              ? messaging.addTelegramOrchestrator({})
              : messaging.addOrchestrator(platform, { workspaceId }),
          ),
        remote: ({ platform, workspaceId }, serverId) =>
          post(serverId, CONNECTORS_ROUTES.messagingOrchestrator, decodeOrchestrator, { platform, workspaceId }),
      }),
      hostGetDiscordAccess: scopedHandler(parseMessagingWorkspaceInput, {
        local: ({ workspaceId }) => runCauseEffect(messaging.discordAccess(workspaceId)),
        remote: ({ workspaceId }, serverId) =>
          postAccess(serverId, DISCORD_ACCESS_ROUTES.access, decodeDiscordAccess, { workspaceId }),
      }),
      hostListDiscordRoles: scopedHandler(parseMessagingWorkspaceInput, {
        local: ({ workspaceId }) => runCauseEffect(messaging.listDiscordRoles(workspaceId)),
        remote: ({ workspaceId }, serverId) =>
          postAccess(serverId, DISCORD_ACCESS_ROUTES.roles, decodeDiscordRoles, { workspaceId }),
      }),
      hostSetDiscordAccess: scopedHandler(parseSetDiscordAccessInput, {
        local: (input) => runCauseEffect(messaging.setDiscordAccess(input)),
        remote: ({ workspaceId, allowedRoles }, serverId) =>
          postAccess(serverId, DISCORD_ACCESS_ROUTES.update, decodeDiscordAccess, {
            workspaceId,
            allowedRoles: allowedRoles.map((role) => ({ id: role.id, name: role.name })),
          }),
      }),
    },
  };
}
