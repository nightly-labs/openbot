import type { MobileWorkspaceState, ServerChecks } from "@/features/workspace/model/workspace-types";

/**
 * A row that the host serves is `enabled`. While the server is not connected, a row that its last
 * connection served is `disabled`, so the menu keeps its rows. A row that the host does not serve is
 * `hidden`, so an older host does not show an action that then fails.
 */
export type ServerRowState = "enabled" | "disabled" | "hidden";

export function serverRowState(
  workspace: Pick<MobileWorkspaceState, "knownServerChecks"> & ServerChecks,
  serverId: string,
  permits: (checks: ServerChecks) => unknown,
): ServerRowState {
  if (permits(workspace)) return "enabled";
  const known = workspace.knownServerChecks(serverId);
  return known && permits(known) ? "disabled" : "hidden";
}
