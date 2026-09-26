import type { ServerSummary } from "@openbot/contracts/ipc";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";

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
      capability === "agent-admin-v1" ||
      capability === "skills-admin-v1" ||
      capability === "shared-tables-v1" ||
      capability === "agent-install-v1" ||
      capability === "providers-v1" ||
      capability === "host-admin-v1") &&
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

/** `server` when it is a joined server this account may manage through `capability`, otherwise undefined. */
export function remoteAdminServer(
  server: ServerSummary | undefined,
  capability: TeamCurrentCapability,
): ServerSummary | undefined {
  return server?.kind === "remote" && serverCanAdminister(server, capability) ? server : undefined;
}
