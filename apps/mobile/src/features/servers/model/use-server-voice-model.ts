import {
  type HostVoiceModel,
  type HostVoiceModelChange,
  type LocalVoiceModelInfo,
  VOICE_MODELS,
} from "@openbot/contracts/ipc";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";

const DOWNLOAD_POLL_MS = 1_000;

export function serverVoiceModels(snapshot: HostVoiceModel): LocalVoiceModelInfo[] {
  return VOICE_MODELS.flatMap((model) =>
    model.kind === "local" &&
    (!model.retired ||
      model.id === snapshot.modelId ||
      snapshot.models.some((status) => status.modelId === model.id && status.phase !== "missing"))
      ? [model]
      : [],
  );
}

export function useServerVoiceModel(serverId: string) {
  const available = useMobileWorkspaceSelector((workspace) => workspace.canManageServerVoiceModel(serverId));
  const { loadServerVoiceModel, changeServerVoiceModel } = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const queryKey = queryKeys.serverVoiceModel(queryScope, serverId);
  const query = useQuery({
    queryKey,
    enabled: available,
    retry: false,
    staleTime: 0,
    queryFn: () => loadServerVoiceModel(serverId),
    refetchInterval: (current) =>
      current.state.data?.models.some((model) => model.phase === "downloading") ? DOWNLOAD_POLL_MS : false,
  });
  return {
    available,
    query,
    async change(change: HostVoiceModelChange): Promise<HostVoiceModel> {
      const saved = await changeServerVoiceModel(change, serverId);
      await queryClient.cancelQueries({ queryKey, exact: true });
      queryClient.setQueryData(queryKey, saved);
      return saved;
    },
  };
}
