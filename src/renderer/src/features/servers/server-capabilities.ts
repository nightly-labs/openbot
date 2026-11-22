import {
  AGENT_PROVIDERS,
  type AgentProviderId,
  agentProviderDescriptor,
  canAdministerServer,
  pasteCodeSignInSupported,
  type ServerSummary,
} from "@openbot/contracts/ipc";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import { MISTRAL_CODE_SIGN_IN_CAPABILITY } from "@openbot/contracts/team-protocol/mistral-code-sign-in-v1";
import { PROVIDER_HOST_SIGN_IN_PROVIDERS } from "@openbot/contracts/team-protocol/provider-host-sign-in-v1";
import { providerSignInRelayProviders } from "@openbot/contracts/team-protocol/provider-sign-in-relays";
import { PROVIDERS_ADMIN_CODE_SIGN_IN_PROVIDERS } from "@openbot/contracts/team-protocol/providers-v1";
import { PROVIDERS_SIGN_IN_V3_PROVIDERS } from "@openbot/contracts/team-protocol/providers-v3";
import { PROVIDERS_V4_SIGN_IN_PROVIDERS } from "@openbot/contracts/team-protocol/providers-v4";
import { PROVIDERS_V8_CAPABILITY } from "@openbot/contracts/team-protocol/providers-v8";
import { SIGN_IN_RELAY_PROVIDERS } from "@openbot/contracts/team-protocol/sign-in-relay-v1";

export function serverSupportsCapability(
  server: ServerSummary | undefined,
  capability: TeamCurrentCapability,
): boolean {
  if (
    (capability === "remote-desktop-setup" ||
      capability === "channel-chats-v1" ||
      capability === "channel-delete-v1" ||
      capability === "channel-attention-v1" ||
      capability === "channel-isolation-v1" ||
      capability === "channel-browser-v1" ||
      capability === "agent-duplication" ||
      capability === "model-scoped-usage" ||
      capability === "browser-navigation" ||
      capability === "browser-view" ||
      capability === "browser-view-clipboard" ||
      capability === "browser-user-control" ||
      capability === "browser-sign-in" ||
      capability === "mcp-servers-v1" ||
      capability === "mcp-sign-in-v1" ||
      capability === "mcp-sign-in-app-v1" ||
      capability === "mcp-accounts-v1" ||
      capability === "mcp-member-access-v1" ||
      capability === "mcp-access-v1" ||
      capability === "live-voice-v1" ||
      capability === "sign-in-relay-v1" ||
      capability === "provider-sign-in-relay-v2" ||
      capability === "connectors-v1" ||
      capability === "onepassword-connector-v1" ||
      capability === "bitwarden-connector-v1" ||
      capability === "password-managers-v1" ||
      capability === "whatsapp-connector-v1" ||
      capability === "vault-v1" ||
      capability === "crm-v1" ||
      capability === "mac-apps-limit-v1" ||
      capability === "ui-block-preview-edit-v1" ||
      capability === "vault-v2" ||
      capability === "vault-v3" ||
      capability === "browser-secret-vault-v1" ||
      capability === "vault-member-save-v1" ||
      capability === "provider-host-sign-in-v1" ||
      capability === "storage-v1" ||
      capability === "storage-disk-v1" ||
      capability === "machine-resources-v1" ||
      capability === "hosted-sites-v1" ||
      capability === "agent-admin-v1" ||
      capability === "agent-host-settings-v1" ||
      capability === "agent-backup-models-v1" ||
      capability === "agent-task-limit-v1" ||
      capability === "agent-plan-card-v1" ||
      capability === "agent-defaults-v1" ||
      capability === "browser-profiles-v1" ||
      capability === "provider-usage-reset-v1" ||
      capability === "skills-admin-v1" ||
      capability === "shared-tables-v1" ||
      capability === "agent-install-v1" ||
      capability === "agent-publish-v1" ||
      capability === "providers-v1" ||
      capability === "providers-v2" ||
      capability === "providers-v3" ||
      capability === "providers-v4" ||
      capability === "providers-v5" ||
      capability === "custom-provider-harness-v1" ||
      capability === "custom-provider-edit-v1" ||
      capability === "custom-provider-harness-choice-v1" ||
      capability === "agent-session-settings-v1" ||
      capability === "acp-registry-v1" ||
      capability === "host-admin-v1" ||
      capability === "host-update-v1" ||
      capability === "host-member-update-v1" ||
      capability === "host-release-v1" ||
      capability === "host-timezone-v1" ||
      capability === "host-turn-limits-v1" ||
      capability === "host-restart-v1" ||
      capability === "host-appearance-v1" ||
      capability === "agent-memory-limit-v1" ||
      capability === "memory-review-v1" ||
      capability === "skill-learning-v1" ||
      capability === "browsing-memory-v1" ||
      capability === "browser-teach-v1" ||
      capability === "prompt-cache-ttl-v1" ||
      capability === "prompt-cache-ttl-pi-v1" ||
      capability === "cache-expiry-compaction-v1" ||
      capability === "model-visibility-v1" ||
      capability === "claude-api-key-v1" ||
      capability === "codex-api-key-v1" ||
      capability === "mistral-code-sign-in-v1" ||
      capability === "host-personality-v1" ||
      capability === "agent-access-v1" ||
      capability === "sidebar-folders-v1" ||
      capability === "library-folders-v1" ||
      capability === "server-audit-v1" ||
      capability === "discord-access-v1" ||
      capability === "whatsapp-working-message-v1" ||
      capability === "whatsapp-status-reactions-v1" ||
      capability === "events-v1" ||
      capability === "context-reset-v1" ||
      capability === "routine-recovery-v1" ||
      capability === "routine-run-place-v1" ||
      capability === "webhook-tests-v1" ||
      capability === "webhook-sender-secret-v1" ||
      capability === "agent-import-v1" ||
      capability === "instance-transfer-v1" ||
      capability === "instance-transfer-chunks-v1" ||
      capability === "instance-transfer-full-copy-v1" ||
      capability === "agent-hidden-v1" ||
      capability === "agent-hidden-work" ||
      capability === "agent-tasks-v1" ||
      capability === "agent-threads-v1" ||
      capability === "agent-thread-reads-v1" ||
      capability === "agent-thread-branches-v1" ||
      capability === "agent-thread-pages-v1" ||
      capability === "agent-thread-replies-v1" ||
      capability === "channel-task-cancel-v1" ||
      capability === "side-question-v1" ||
      capability === "side-question-threads-v1" ||
      capability === "workflows-github-v1" ||
      capability === "agent-notification-levels-v1" ||
      capability === "sidebar-pins-v1" ||
      capability === "agent-new-chat-v1" ||
      capability === "agent-folders-v1" ||
      capability === "agent-fast-mode-v1" ||
      capability === "context-compact-v1" ||
      capability === "agent-instructions-v1" ||
      capability === "message-delete-v1" ||
      capability === "feedback-withdraw-v1" ||
      capability === "message-pins-v1" ||
      capability === "chat-history-v1" ||
      capability === "conversation-unread-from-v1" ||
      capability === "conversation-file-search-v1" ||
      capability === "custom-agents-v1" ||
      capability === "host-key-rotation-v1" ||
      capability === "routine-results-v1" ||
      capability === "workflows-chats-v1" ||
      capability === "workflows-channels-v1" ||
      capability === "workflows-media-v1" ||
      capability === "workflows-agent-files-v1" ||
      capability === "vault-import-v1" ||
      capability === "agent-waits-v1" ||
      capability === "agent-queue-task-v1" ||
      capability === "background-processes-v1" ||
      capability === "routines-once-v1" ||
      capability === "routine-run-command-v1" ||
      capability === "claude-user-setup-v1" ||
      capability === "claude-compact-window-v1" ||
      capability === "provider-environment-v1" ||
      capability === "agent-usage-limit-v1" ||
      capability === "hermes-import-v1" ||
      capability === "owner-transfer-v1" ||
      capability === "provider-detection-v1") &&
    server?.kind === "remote"
  ) {
    return server.compatibility?.capabilities.includes(capability) === true;
  }
  return server?.kind !== "remote" || !server.compatibility || server.compatibility.capabilities.includes(capability);
}

export function remoteRoutineRecovery(server: ServerSummary | undefined): boolean {
  return server?.kind === "remote" && serverCanAdminister(server, "routine-recovery-v1");
}

export function serverSendsWebhookTests(server: ServerSummary | undefined): boolean {
  return serverCanAdminister(server, "webhook-tests-v1");
}

export function serverSetsWebhookSenderSecret(server: ServerSummary | undefined): boolean {
  return serverCanAdminister(server, "webhook-sender-secret-v1");
}

export function serverGivesWebhookSecretToAgent(server: ServerSummary | undefined): boolean {
  return serverCanAdminister(server, "webhook-agent-secret-v1");
}

export function remoteMcpSignIn(server: ServerSummary | undefined): boolean {
  return (
    server?.kind === "remote" && serverCanManageMcp(server) && serverSupportsCapability(server, "sign-in-relay-v1")
  );
}

export function hostSignInProviders(server: ServerSummary | undefined): readonly AgentProviderId[] {
  return server?.kind === "remote" &&
    server.active &&
    serverSupportsCapability(server, "provider-host-sign-in-v1") &&
    serverSupportsCapability(server, "browser-view")
    ? PROVIDER_HOST_SIGN_IN_PROVIDERS
    : [];
}

export function relaySignInProviders(server: ServerSummary | undefined): readonly AgentProviderId[] {
  return server?.kind === "remote"
    ? providerSignInRelayProviders((capability) => serverSupportsCapability(server, capability))
    : [];
}

export function serverRotatesHostKey(server: ServerSummary | undefined): server is ServerSummary {
  if (server?.kind === "local") return true;
  return server?.role === "owner" && serverSupportsCapability(server, "host-key-rotation-v1");
}

export function serverRoleCanAdminister(server: Pick<ServerSummary, "kind" | "role"> | undefined): boolean {
  return server?.kind === "local" || canAdministerServer(server?.role);
}

export function serverCanAdminister(
  server: ServerSummary | undefined,
  capability?: TeamCurrentCapability,
): server is ServerSummary {
  if (!server) return false;
  if (server.kind === "local") return true;
  return serverRoleCanAdminister(server) && (!capability || serverSupportsCapability(server, capability));
}

export function serverCodeRouteProviders(server: ServerSummary | undefined): readonly AgentProviderId[] {
  if (server?.kind !== "remote") return [];
  if (serverSupportsCapability(server, "providers-v4")) {
    const paste = serverSupportsCapability(server, "providers-v3");
    const v4: readonly AgentProviderId[] = PROVIDERS_V4_SIGN_IN_PROVIDERS.filter(
      (provider) => paste || agentProviderDescriptor(provider).localCodeSignIn !== "paste",
    );
    if (!serverSupportsCapability(server, PROVIDERS_V8_CAPABILITY)) return v4;
    const earlier: readonly AgentProviderId[] = [...PROVIDERS_V4_SIGN_IN_PROVIDERS, ...SIGN_IN_RELAY_PROVIDERS];
    return AGENT_PROVIDERS.filter(
      (provider) =>
        v4.includes(provider) ||
        (agentProviderDescriptor(provider).localCodeSignIn === "device" && !earlier.includes(provider)) ||
        (provider === "mistral" && serverSupportsCapability(server, MISTRAL_CODE_SIGN_IN_CAPABILITY)),
    );
  }
  if (serverSupportsCapability(server, "providers-v3")) return PROVIDERS_SIGN_IN_V3_PROVIDERS;
  return serverSupportsCapability(server, "providers-v1") ? PROVIDERS_ADMIN_CODE_SIGN_IN_PROVIDERS : [];
}

export function localCodeSignInProviders(platform: string | undefined): readonly AgentProviderId[] {
  const paste = platform !== undefined && pasteCodeSignInSupported(platform);
  return AGENT_PROVIDERS.filter((provider) => {
    const codeSignIn = agentProviderDescriptor(provider).localCodeSignIn;
    return codeSignIn === "device" || (codeSignIn === "paste" && paste);
  });
}

export function serverCanManageMcp(server: ServerSummary | undefined): server is ServerSummary {
  if (!server || !serverSupportsCapability(server, "mcp-servers-v1")) return false;
  return serverRoleCanAdminister(server) || serverSupportsCapability(server, "mcp-member-access-v1");
}

export function remoteAdminServer(
  server: ServerSummary | undefined,
  capability: TeamCurrentCapability,
): ServerSummary | undefined {
  return server?.kind === "remote" && serverCanAdminister(server, capability) ? server : undefined;
}

export function activeServerHasProviderSettings(server: ServerSummary): boolean {
  return server.kind === "local" || remoteAdminServer(server, "providers-v1") !== undefined;
}

export function serverHasAgentDefaults(server: ServerSummary): boolean {
  return serverCanAdminister(server, "agent-defaults-v1") && (server.kind === "local" || server.state === "online");
}

export function olderAppSide(clientVersion: string, hostVersion: string): "client" | "host" | null {
  const parse = (version: string) => /^v?(\d+)\.(\d+)\.(\d+)/u.exec(version)?.slice(1).map(Number) ?? null;
  const [client, host] = [parse(clientVersion), parse(hostVersion)];
  if (!client || !host) return null;
  for (let index = 0; index < 3; index += 1) {
    const difference = (client[index] ?? 0) - (host[index] ?? 0);
    if (difference !== 0) return difference > 0 ? "host" : "client";
  }
  return null;
}

export function remoteUpdateServer(server: ServerSummary | undefined): ServerSummary | undefined {
  if (server?.kind !== "remote") return undefined;
  return serverSupportsCapability(server, "host-member-update-v1")
    ? server
    : remoteAdminServer(server, "host-update-v1");
}
