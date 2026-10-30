import {
  AGENT_PROVIDERS,
  type AgentProviderId,
  agentProviderDescriptor,
  canAdministerServer,
  pasteCodeSignInSupported,
  type ServerSummary,
} from "@openbot/contracts/ipc";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import { PROVIDER_HOST_SIGN_IN_PROVIDERS } from "@openbot/contracts/team-protocol/provider-host-sign-in-v1";
import { PROVIDERS_ADMIN_CODE_SIGN_IN_PROVIDERS } from "@openbot/contracts/team-protocol/providers-v1";
import { PROVIDERS_SIGN_IN_V3_PROVIDERS } from "@openbot/contracts/team-protocol/providers-v3";
import { PROVIDERS_V4_SIGN_IN_PROVIDERS } from "@openbot/contracts/team-protocol/providers-v4";
import { SIGN_IN_RELAY_PROVIDERS } from "@openbot/contracts/team-protocol/sign-in-relay-v1";

/**
 * Whether a server can be asked for a capability-gated feature. A local server
 * can do everything; a remote one that never negotiated compatibility is given
 * the benefit of the doubt, except for features that require explicit support.
 */
export function serverSupportsCapability(
  server: ServerSummary | undefined,
  capability: TeamCurrentCapability,
): boolean {
  if (
    (capability === "remote-desktop-setup" ||
      capability === "channel-chats-v1" ||
      capability === "channel-delete-v1" ||
      capability === "channel-attention-v1" ||
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
      capability === "sign-in-relay-v1" ||
      capability === "connectors-v1" ||
      capability === "onepassword-connector-v1" ||
      capability === "bitwarden-connector-v1" ||
      capability === "vault-v1" ||
      capability === "vault-v2" ||
      capability === "browser-secret-vault-v1" ||
      capability === "provider-host-sign-in-v1" ||
      capability === "storage-v1" ||
      capability === "storage-disk-v1" ||
      capability === "machine-resources-v1" ||
      capability === "hosted-sites-v1" ||
      capability === "agent-admin-v1" ||
      capability === "agent-host-settings-v1" ||
      capability === "agent-backup-models-v1" ||
      capability === "agent-task-limit-v1" ||
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
      capability === "agent-session-settings-v1" ||
      capability === "acp-registry-v1" ||
      capability === "host-admin-v1" ||
      capability === "host-update-v1" ||
      capability === "host-member-update-v1" ||
      capability === "host-release-v1" ||
      capability === "host-timezone-v1" ||
      capability === "agent-memory-limit-v1" ||
      capability === "memory-review-v1" ||
      capability === "prompt-cache-ttl-v1" ||
      capability === "claude-api-key-v1" ||
      capability === "agent-access-v1" ||
      capability === "discord-access-v1" ||
      capability === "events-v1" ||
      capability === "context-reset-v1" ||
      capability === "routine-flows-v1" ||
      capability === "routine-recovery-v1" ||
      capability === "webhook-tests-v1" ||
      capability === "agent-import-v1" ||
      capability === "instance-transfer-v1" ||
      capability === "agent-hidden-v1" ||
      capability === "agent-tasks-v1" ||
      capability === "agent-threads-v1" ||
      capability === "agent-thread-reads-v1" ||
      capability === "side-question-v1") &&
    server?.kind === "remote"
  ) {
    return server.compatibility?.capabilities.includes(capability) === true;
  }
  return server?.kind !== "remote" || !server.compatibility || server.compatibility.capabilities.includes(capability);
}

/**
 * Whether the routine editor sends a joined server's routines through `routine-recovery-v1`, which
 * keeps `missedPolicy` and the missed-run history. This computer's host keeps them through IPC.
 */
export function remoteRoutineRecovery(server: ServerSummary | undefined): boolean {
  return server?.kind === "remote" && serverCanAdminister(server, "routine-recovery-v1");
}

/** Whether the routine editor can ask the host for a test event: this computer, or a joined server with `webhook-tests-v1`. */
export function serverSendsWebhookTests(server: ServerSummary | undefined): boolean {
  return serverCanAdminister(server, "webhook-tests-v1");
}

/**
 * Whether a joined server signs in to an MCP server for this computer. With `sign-in-relay-v1` the
 * page opens in this computer's browser and the callback is relayed to the host. An older host opens
 * the page in its own browser, and the live view shows it; the live view streams the active server only.
 */
export function remoteMcpSignIn(server: ServerSummary | undefined): boolean {
  if (server?.kind !== "remote") return false;
  if (serverSupportsCapability(server, "sign-in-relay-v1")) return true;
  return (
    server.active &&
    serverSupportsCapability(server, "mcp-sign-in-v1") &&
    serverSupportsCapability(server, "browser-view")
  );
}

/**
 * The providers a joined server signs in on a page in its own browser, which the live view shows
 * here. Only a Linux host advertises it, and the live view streams the active server only.
 */
export function hostSignInProviders(server: ServerSummary | undefined): readonly AgentProviderId[] {
  return server?.kind === "remote" &&
    server.active &&
    serverSupportsCapability(server, "provider-host-sign-in-v1") &&
    serverSupportsCapability(server, "browser-view")
    ? PROVIDER_HOST_SIGN_IN_PROVIDERS
    : [];
}

/**
 * The providers a joined server signs in on a page in this computer's browser, with the callback
 * relayed to the host (`sign-in-relay-v1`). The user's own browser keeps their sessions, so these win
 * over the host's code and live view.
 */
export function relaySignInProviders(server: ServerSummary | undefined): readonly AgentProviderId[] {
  return server?.kind === "remote" && serverSupportsCapability(server, "sign-in-relay-v1")
    ? SIGN_IN_RELAY_PROVIDERS
    : [];
}

/** An owner or admin of a joined server. This computer is always its own administrator. */
export function serverRoleCanAdminister(server: Pick<ServerSummary, "kind" | "role"> | undefined): boolean {
  return server?.kind === "local" || canAdministerServer(server?.role);
}

/**
 * Whether this window may manage the host behind `server`: this computer, or a joined server where
 * the account is an owner or admin and the host serves `capability`. The host checks the role again
 * on every admin route; this only decides what the UI offers.
 */
export function serverCanAdminister(
  server: ServerSummary | undefined,
  capability?: TeamCurrentCapability,
): server is ServerSummary {
  if (!server) return false;
  if (server.kind === "local") return true;
  return serverRoleCanAdminister(server) && (!capability || serverSupportsCapability(server, capability));
}

/**
 * The providers that the host's own code route signs in on `server`: a device code, a pasted code
 * or a link. A host with `providers-v4` signs in its providers, and the pasted-code ones only when
 * it also has `providers-v3`, which only a host that can run a pasted code advertises. A host with
 * `providers-v3` alone signs in its own list, and a host with `providers-v1` alone Codex only. The
 * providers that a host signs in on a page are in `hostSignInProviders` and `relaySignInProviders`.
 */
export function serverCodeRouteProviders(server: ServerSummary | undefined): readonly AgentProviderId[] {
  if (server?.kind !== "remote") return [];
  if (serverSupportsCapability(server, "providers-v4")) {
    const paste = serverSupportsCapability(server, "providers-v3");
    return PROVIDERS_V4_SIGN_IN_PROVIDERS.filter(
      (provider) => paste || agentProviderDescriptor(provider).localCodeSignIn !== "paste",
    );
  }
  if (serverSupportsCapability(server, "providers-v3")) return PROVIDERS_SIGN_IN_V3_PROVIDERS;
  return serverSupportsCapability(server, "providers-v1") ? PROVIDERS_ADMIN_CODE_SIGN_IN_PROVIDERS : [];
}

/**
 * The providers that a code sign-in reaches on this computer, for when the browser callback cannot
 * reach OpenBot: each provider whose driver has one. A pasted code needs a terminal that only some
 * platforms give it.
 */
export function localCodeSignInProviders(platform: string | undefined): readonly AgentProviderId[] {
  const paste = platform !== undefined && pasteCodeSignInSupported(platform);
  return AGENT_PROVIDERS.filter((provider) => {
    const codeSignIn = agentProviderDescriptor(provider).localCodeSignIn;
    return codeSignIn === "device" || (codeSignIn === "paste" && paste);
  });
}

/** `server` when it is a joined server this account may manage through `capability`, otherwise undefined. */
export function remoteAdminServer(
  server: ServerSummary | undefined,
  capability: TeamCurrentCapability,
): ServerSummary | undefined {
  return server?.kind === "remote" && serverCanAdminister(server, capability) ? server : undefined;
}

/**
 * Which side of a connection runs the older OpenBot release, so a version notice can say what to
 * update. Only the release numbers count. `null` when they are equal or one does not parse.
 */
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

/** A joined server with member update access, or the released administrator update API. */
export function remoteUpdateServer(server: ServerSummary | undefined): ServerSummary | undefined {
  if (server?.kind !== "remote") return undefined;
  return serverSupportsCapability(server, "host-member-update-v1")
    ? server
    : remoteAdminServer(server, "host-update-v1");
}
