import type { HostSignalHomeSettings } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";

const SIGNAL_HOME_PLACES: Readonly<Record<string, MobileTextKey>> = {
  a: "mobile.server.settings.signalHomePlaceHelsinki1",
  b: "mobile.server.settings.signalHomePlaceHelsinki2",
  us: "mobile.server.settings.signalHomePlaceSanJose",
  au: "mobile.server.settings.signalHomePlaceSydney",
  sg: "mobile.server.settings.signalHomePlaceSingapore",
};

export function signalHomePlaceKey(id: string): MobileTextKey | undefined {
  return SIGNAL_HOME_PLACES[id];
}

export type SignalLatencyTone = "success" | "warning" | "danger";

const FAST_LATENCY_MS = 100;
const SLOW_LATENCY_MS = 200;

export function signalLatencyTone(latencyMs: number | null): SignalLatencyTone {
  if (latencyMs === null || latencyMs >= SLOW_LATENCY_MS) return "danger";
  return latencyMs < FAST_LATENCY_MS ? "success" : "warning";
}

export const SIGNAL_LATENCY_TEXT_CLASS: Readonly<Record<SignalLatencyTone, string>> = {
  success: "text-success-text",
  warning: "text-warning-text",
  danger: "text-danger-text",
};

export function useServerSignalHome(serverId: string) {
  const available = useMobileWorkspaceSelector((workspace) => workspace.canManageServerSignalHome(serverId));
  const served = useMobileWorkspaceSelector((workspace) => workspace.servesServerSignalHome(serverId));
  const { loadServerSignalHome, setServerSignalHome } = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const queryKey = queryKeys.serverSignalHome(queryScope, serverId);
  const query = useQuery({
    queryKey,
    enabled: served,
    retry: false,
    staleTime: 0,
    queryFn: () => loadServerSignalHome(serverId),
  });
  return {
    available,
    served,
    query,
    async save(home: string | null): Promise<HostSignalHomeSettings> {
      const saved = await setServerSignalHome(home, serverId);
      await queryClient.cancelQueries({ queryKey, exact: true });
      queryClient.setQueryData(queryKey, saved);
      return saved;
    },
  };
}
