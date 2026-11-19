import { showsOnline } from "@/features/workspace/model/server-status";
import type { MobileWorkspaceState, ServerChecks } from "@/features/workspace/model/workspace-types";

export type ServerRowState = "enabled" | "disabled" | "hidden";

export function serverRowState(
  workspace: Pick<MobileWorkspaceState, "knownServerChecks" | "servers"> & ServerChecks,
  serverId: string,
  permits: (checks: ServerChecks) => unknown,
): ServerRowState {
  const online = showsOnline(workspace.servers.find((server) => server.id === serverId));
  if (online && permits(workspace)) return "enabled";
  const known = workspace.knownServerChecks(serverId);
  return known && permits(known) ? "disabled" : "hidden";
}
