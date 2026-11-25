import type { HostPersonality, ResponseStyle } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";

export const RESPONSE_STYLE_LABEL_KEYS = {
  natural: "mobile.server.settings.responseStyleNatural",
  classic: "mobile.server.settings.responseStyleClassic",
} as const satisfies Record<ResponseStyle, MobileTextKey>;

export function useServerPersonality(serverId: string | undefined) {
  const { loadServerPersonality, setServerPersonality } = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const id = serverId ?? "";
  const served = useMobileWorkspaceSelector((workspace) => Boolean(serverId) && workspace.servesServerPersonality(id));
  const canManage = useMobileWorkspaceSelector(
    (workspace) => Boolean(serverId) && workspace.canManageServerPersonality(id),
  );
  const online = useMobileWorkspaceSelector((workspace) =>
    workspace.servers.some((server) => server.id === serverId && server.state === "online"),
  );
  const queryKey = queryKeys.serverPersonality(queryScope, id);
  const query = useQuery({
    queryKey,
    enabled: Boolean(serverId) && online,
    retry: false,
    staleTime: 0,
    gcTime: Number.POSITIVE_INFINITY,
    queryFn: () => loadServerPersonality(id),
  });
  const wasServed = useRef(served);
  useEffect(() => {
    const key = queryKeys.serverPersonality(queryScope, id);
    if (served && !wasServed.current && queryClient.isFetching({ queryKey: key, exact: true }) === 0)
      void queryClient.invalidateQueries({ queryKey: key, exact: true });
    wasServed.current = served;
  }, [served, queryClient, queryScope, id]);
  return {
    canManage,
    query,
    async save(personality: HostPersonality): Promise<HostPersonality> {
      const saved = await setServerPersonality(personality, id);
      await queryClient.cancelQueries({ queryKey, exact: true });
      queryClient.setQueryData(queryKey, saved);
      return saved;
    },
  };
}

export function useServerResponseStyle(serverId: string | undefined): ResponseStyle | undefined {
  return useServerPersonality(serverId).query.data?.responseStyle;
}
