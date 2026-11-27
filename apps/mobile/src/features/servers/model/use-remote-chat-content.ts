import { useQuery } from "@tanstack/react-query";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";

export function useRemoteChatContent(serverId: string | undefined): boolean {
  const { loadRemoteChatContent } = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const id = serverId ?? "";
  const served = useMobileWorkspaceSelector((workspace) => Boolean(serverId) && workspace.servesRemoteChatContent(id));
  const query = useQuery({
    queryKey: queryKeys.remoteChatContent(queryScope, id),
    enabled: served,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    queryFn: () => loadRemoteChatContent(id),
  });
  return served && query.data?.enabled === true;
}
