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
    (capability === "channel-chats-v1" ||
      capability === "channel-delete-v1" ||
      capability === "agent-duplication" ||
      capability === "model-scoped-usage") &&
    server?.kind === "remote"
  ) {
    return server.compatibility?.capabilities.includes(capability) === true;
  }
  return server?.kind !== "remote" || !server.compatibility || server.compatibility.capabilities.includes(capability);
}
