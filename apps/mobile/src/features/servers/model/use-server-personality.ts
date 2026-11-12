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

/**
 * The server personality (`host-personality-v1`), as Server settings and the chats of the server read
 * it. Each chat reads it again when it opens, as on desktop, so a change from another device shows
 * then. The last known value stays while the server is offline.
 */
export function useServerPersonality(serverId: string | undefined) {
  const { loadServerPersonality, setServerPersonality } = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const id = serverId ?? "";
  // Selectors, so a chat does not render again for each unrelated change of the workspace.
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
    // A host that does not serve the capability answers "classic" with no request.
    enabled: Boolean(serverId) && online,
    retry: false,
    staleTime: 0,
    gcTime: Number.POSITIVE_INFINITY,
    queryFn: () => loadServerPersonality(id),
  });
  // A read before the host's capabilities arrived answered "classic", so the host is read again.
  const wasServed = useRef(served);
  useEffect(() => {
    const key = queryKeys.serverPersonality(queryScope, id);
    // Each mounted chat sees the change. The first one reads the host again; the others see that read.
    if (served && !wasServed.current && queryClient.isFetching({ queryKey: key, exact: true }) === 0)
      void queryClient.invalidateQueries({ queryKey: key, exact: true });
    wasServed.current = served;
  }, [served, queryClient, queryScope, id]);
  return {
    /** An owner or admin of a host that serves `host-personality-v1`. */
    canManage,
    query,
    /** Resolves with the personality that the host saved. */
    async save(personality: HostPersonality): Promise<HostPersonality> {
      const saved = await setServerPersonality(personality, id);
      await queryClient.cancelQueries({ queryKey, exact: true });
      queryClient.setQueryData(queryKey, saved);
      return saved;
    },
  };
}

/**
 * The response style of a server, or undefined until its host answered. A chat shows progress
 * updates as messages only for a "natural" server.
 */
export function useServerResponseStyle(serverId: string | undefined): ResponseStyle | undefined {
  return useServerPersonality(serverId).query.data?.responseStyle;
}
