import { useQuery } from "@tanstack/react-query";
import { useIsFocused } from "expo-router";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useMobileWorkspace, useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { useAppForeground } from "@/shared/lib/use-app-foreground";

/** As on desktop: memory and CPU change fast, so the reading is live. The host reads CPU since the reading before. */
const MACHINE_REFRESH_MS = 5_000;

/**
 * The machine use of a server (`machine-resources-v1`), for an owner or admin. It reads again every few
 * seconds while the screen is on top and the app is in the foreground, and stops otherwise.
 */
export function useMachineMetrics(serverId: string) {
  const { canReadMachineMetrics } = useMobileWorkspace();
  const { loadMachineMetrics } = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const focused = useIsFocused();
  const foreground = useAppForeground();
  const available = canReadMachineMetrics(serverId);
  const live = available && focused && foreground;
  const query = useQuery({
    queryKey: queryKeys.machineMetrics(queryScope, serverId),
    queryFn: () => loadMachineMetrics(serverId),
    enabled: live,
    refetchInterval: live ? MACHINE_REFRESH_MS : false,
    retry: false,
    staleTime: 0,
  });
  return { available, query };
}
