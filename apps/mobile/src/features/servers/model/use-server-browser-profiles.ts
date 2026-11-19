import type { AgentBrowserProfile, AvatarHue, BrowserProfileList, BrowserProfileSummary } from "@openbot/contracts/ipc";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";

export function useServerBrowserProfiles(serverId: string) {
  const available = useMobileWorkspaceSelector((workspace) => workspace.canManageBrowserProfiles(serverId));
  const actions = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const queryKey = queryKeys.serverBrowserProfiles(queryScope, serverId);
  const query = useQuery({
    queryKey,
    enabled: available,
    retry: false,
    staleTime: 0,
    queryFn: () => actions.loadBrowserProfiles(serverId),
  });

  async function changed(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey, exact: true }).catch(() => undefined);
  }

  return {
    available,
    query,
    profiles: query.data?.profiles,
    sharedAgentIds: query.data?.sharedAgentIds,
    async create(name: string): Promise<BrowserProfileSummary> {
      const profile = await actions.createBrowserProfile(name, serverId);
      queryClient.setQueryData<BrowserProfileList>(queryKey, (current) =>
        current && !current.profiles.some((item) => item.id === profile.id)
          ? { ...current, profiles: [...current.profiles, profile] }
          : current,
      );
      await changed();
      return profile;
    },
    async rename(profileId: string, name: string): Promise<void> {
      await actions.updateBrowserProfile({ profileId, name }, serverId);
      await changed();
    },
    async recolor(profileId: string, hue: AvatarHue): Promise<void> {
      await actions.updateBrowserProfile({ profileId, hue }, serverId);
      await changed();
    },
    async clear(profileId: string): Promise<void> {
      await actions.clearBrowserData({ profileId }, serverId);
      await changed();
    },
    async assign(agentId: string, profile: AgentBrowserProfile): Promise<void> {
      const saved = await actions.updateAgentBrowserProfile({ agentId, profile }, serverId);
      queryClient.setQueryData(queryKeys.agentRecord(queryScope, serverId, agentId, "browser-profile"), saved);
      await changed();
    },
    async remove(profileId: string): Promise<void> {
      await actions.deleteBrowserProfile(profileId, serverId);
      queryClient.setQueryData<BrowserProfileList>(queryKey, (current) =>
        current ? { ...current, profiles: current.profiles.filter((item) => item.id !== profileId) } : current,
      );
      await changed();
    },
  };
}

export function useAgentBrowserProfile(serverId: string, agentId: string | undefined) {
  const available = useMobileWorkspaceSelector((workspace) => workspace.canManageBrowserProfiles(serverId));
  const actions = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const queryKey = queryKeys.agentRecord(queryScope, serverId, agentId ?? "", "browser-profile");
  const query = useQuery({
    queryKey,
    enabled: available && agentId !== undefined,
    retry: false,
    staleTime: 0,
    queryFn: () => actions.loadAgentBrowserProfile(agentId ?? "", serverId),
  });
  return {
    available,
    query,
    async choose(profile: AgentBrowserProfile): Promise<void> {
      if (agentId === undefined) return;
      const previous = queryClient.getQueryData<AgentBrowserProfile>(queryKey);
      await queryClient.cancelQueries({ queryKey, exact: true });
      queryClient.setQueryData(queryKey, profile);
      try {
        queryClient.setQueryData(queryKey, await actions.updateAgentBrowserProfile({ agentId, profile }, serverId));
      } catch (cause) {
        queryClient.setQueryData(queryKey, previous);
        throw cause;
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.serverBrowserProfiles(queryScope, serverId) });
    },
  };
}
