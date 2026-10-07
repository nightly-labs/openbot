import {
  AGENT_PROVIDERS,
  type AgentProviderId,
  agentProviderDescriptor,
  type ServerSummary,
} from "@openbot/contracts/ipc";
import { AGENT_WORKING_DIRECTORY_CAPABILITY } from "@openbot/contracts/team-protocol/agent-working-directory-v1";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import { PROVIDERS_SIGN_IN_V3_PROVIDERS } from "@openbot/contracts/team-protocol/providers-v3";
import { PROVIDERS_V4_SIGN_IN_PROVIDERS } from "@openbot/contracts/team-protocol/providers-v4";

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
      capability === "agent-duplication" ||
      capability === "model-scoped-usage" ||
      capability === "browser-navigation" ||
      capability === "browser-view" ||
      capability === "mcp-servers-v1" ||
      capability === "storage-v1" ||
      capability === "hosted-sites-v1" ||
      capability === "agent-admin-v1" ||
      capability === "skills-admin-v1" ||
      capability === "shared-tables-v1" ||
      capability === "agent-install-v1" ||
      capability === "agent-publish-v1" ||
      capability === "providers-v1" ||
      capability === "providers-v2" ||
      capability === "providers-v3" ||
      capability === "providers-v4" ||
      capability === "host-admin-v1" ||
      capability === "host-update-v1" ||
      capability === "context-reset-v1" ||
      capability === "agent-import-v1" ||
      capability === AGENT_WORKING_DIRECTORY_CAPABILITY) &&
    server?.kind === "remote"
  ) {
    return server.compatibility?.capabilities.includes(capability) === true;
  }
  return server?.kind !== "remote" || !server.compatibility || server.compatibility.capabilities.includes(capability);
}

/** An owner or admin of a joined server. This computer is always its own administrator. */
export function serverRoleCanAdminister(server: Pick<ServerSummary, "kind" | "role"> | undefined): boolean {
  return server?.kind === "local" || server?.role === "owner" || server?.role === "admin";
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
 * The providers that a code sign-in reaches on `server`. A host with `providers-v4` signs in Codex,
 * Grok, Cursor and Cline, and Claude when it also has `providers-v3`, which only a host that can run
 * the Claude pasted code advertises. A host with `providers-v3` alone signs in Codex, Claude and Grok.
 * This computer, and an older host, sign in with a code only the providers whose descriptor says so:
 * this computer has a browser for the others.
 */
export function codeSignInProviders(server: ServerSummary | undefined): readonly AgentProviderId[] {
  if (server?.kind === "remote" && serverSupportsCapability(server, "providers-v4")) {
    const paste = serverSupportsCapability(server, "providers-v3");
    return PROVIDERS_V4_SIGN_IN_PROVIDERS.filter((provider) => paste || provider !== "claude");
  }
  if (server?.kind === "remote" && serverSupportsCapability(server, "providers-v3"))
    return PROVIDERS_SIGN_IN_V3_PROVIDERS;
  return AGENT_PROVIDERS.filter((provider) => agentProviderDescriptor(provider).codeSignIn);
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
