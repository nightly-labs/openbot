import type { AgentBrowserProfile, AvatarHue, BrowserProfileList, BrowserProfileSummary } from "@openbot/contracts/ipc";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";

/**
 * The named browser profiles of one host (`browser-profiles-v1`), as Server settings, the profile
 * page and the agent's profile choice show them. All pages read one query. Each change reads the
 * list again, because a change can also move agents and close tabs, which the summaries count. The
 * host sends `browser-profiles-changed` for a change made on the desktop or another device, and
 * that event reads the list again while a page shows it.
 */
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
    // The change is done when the list fails, so a failed list does not report it as failed.
    await queryClient.invalidateQueries({ queryKey, exact: true }).catch(() => undefined);
  }

  return {
    available,
    query,
    profiles: query.data?.profiles,
    sharedAgentIds: query.data?.sharedAgentIds,
    /** Resolves with the new profile, which is in the list already. */
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
    /** Gives one agent a profile, or moves it to the shared profile. The host closes the agent's open tabs. */
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

/**
 * The browser profile of one agent, as its host gives it: the agent summary does not carry it. The
 * key ends in "browser-profile", so `agents-changed` and `browser-profiles-changed` read it again.
 */
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
    /** Shows the choice at once and goes back when the host refuses it. */
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
      // The agent counts of the profiles changed too.
      void queryClient.invalidateQueries({ queryKey: queryKeys.serverBrowserProfiles(queryScope, serverId) });
    },
  };
}
