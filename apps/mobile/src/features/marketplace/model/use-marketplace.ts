import type { InstalledSkill } from "@openbot/contracts/ipc";
import { useInfiniteQuery, useQueries } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { agentSkillsQuery } from "@/features/agents/model/agent-skills-query";
import { useMobileSession, useQueryScope } from "@/features/auth/context/mobile-session-context";
import { CONNECTOR_TITLE_KEYS } from "@/features/servers/model/connectors";
import { useConnectorRows } from "@/features/servers/model/use-connector-rows";
import { useMcpServerList } from "@/features/servers/model/use-server-mcp";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { useText } from "@/shared/lib/text";
import { listMarketplaceAgents, listMarketplaceSkills, MARKETPLACE_PAGE_SIZE } from "../api/marketplace-catalog";
import {
  agentListing,
  appListings,
  CONNECTOR_TAGLINES,
  connectorListing,
  customListing,
  type MarketplaceFilter,
  type MarketplaceListing,
  matchesQuery,
  skillListing,
} from "./marketplace-listings";
import type { MobilePlugin } from "./plugin-catalog.generated";
import { claimedByPlugin, pluginInstalled } from "./plugin-connect";
import { useMobilePlugins } from "./use-mobile-plugins";

const CATALOG_FRESH_MS = 5 * 60_000;
const SEARCH_DEBOUNCE_MS = 220;

function useDebounced(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function useServerApps(serverId: string, plugins: readonly MobilePlugin[]) {
  const { t } = useText();
  const rows = useConnectorRows(serverId);
  const { list: mcpServers } = useMcpServerList(serverId);
  const apps = useMemo(
    (): MarketplaceListing[] => [
      ...rows.flatMap(
        (row) => connectorListing(row, t(CONNECTOR_TITLE_KEYS[row.id]), t(CONNECTOR_TAGLINES[row.id])) ?? [],
      ),
      ...(mcpServers.data ?? [])
        .filter((server) => !plugins.some((plugin) => claimedByPlugin(server, plugin)))
        .map(customListing),
    ],
    [rows, mcpServers.data, plugins, t],
  );
  return { apps, mcpServers };
}

export function useMarketplaceCatalog({
  serverId,
  query,
  filter,
}: {
  serverId: string;
  query: string;
  filter: MarketplaceFilter;
}) {
  const { session } = useMobileSession();
  const plugins = useMobilePlugins(serverId);
  const { apps: serverApps, mcpServers } = useServerApps(serverId, plugins);
  const apiUrl = session?.apiUrl ?? null;
  const search = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS);
  const category = filter.category;
  const listQuery = {
    sort: "installs" as const,
    limit: MARKETPLACE_PAGE_SIZE,
    ...(search ? { query: search } : {}),
    ...(category ? { category } : {}),
  };
  const showAgents = filter.kind === null || filter.kind === "agent";
  const showSkills = filter.kind === null || filter.kind === "skill";
  const agents = useInfiniteQuery({
    queryKey: queryKeys.marketplace(apiUrl, "agents", search, category),
    enabled: apiUrl !== null && showAgents,
    staleTime: CATALOG_FRESH_MS,
    initialPageParam: "",
    queryFn: ({ pageParam, signal }) =>
      listMarketplaceAgents(apiUrl ?? "", { ...listQuery, cursor: pageParam || undefined }, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const skills = useInfiniteQuery({
    queryKey: queryKeys.marketplace(apiUrl, "skills", search, category),
    enabled: apiUrl !== null && showSkills,
    staleTime: CATALOG_FRESH_MS,
    initialPageParam: "",
    queryFn: ({ pageParam, signal }) =>
      listMarketplaceSkills(apiUrl ?? "", { ...listQuery, cursor: pageParam || undefined }, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const listings = useMemo(() => {
    if (!apiUrl) return [];
    return [
      ...(agents.data?.pages ?? []).flatMap((page) => page.agents.map((agent) => agentListing(apiUrl, agent))),
      ...[...serverApps, ...appListings(apiUrl, plugins)].filter((app) => matchesQuery(app, search)),
      ...(skills.data?.pages ?? []).flatMap((page) => page.skills.map((skill) => skillListing(apiUrl, skill))),
    ];
  }, [apiUrl, agents.data, skills.data, search, serverApps, plugins]);
  const pending =
    (agents.isPending && agents.fetchStatus !== "idle") || (skills.isPending && skills.fetchStatus !== "idle");
  const { fetchNextPage: moreAgents } = agents;
  const { fetchNextPage: moreSkills } = skills;
  const agentsMore = showAgents && agents.hasNextPage;
  const skillsMore = showSkills && skills.hasNextPage;
  return {
    listings,
    search,
    pending,
    failed: (agents.isError && !agents.data) || (skills.isError && !skills.data) || mcpServers.isError,
    refetch: () => Promise.all([agents.refetch(), skills.refetch(), mcpServers.isError ? mcpServers.refetch() : null]),
    hasMore: agentsMore || skillsMore,
    loadingMore: agents.isFetchingNextPage || skills.isFetchingNextPage,
    loadMoreFailed: (showAgents && agents.isFetchNextPageError) || (showSkills && skills.isFetchNextPageError),
    loadMore: () => Promise.all([agentsMore ? moreAgents() : null, skillsMore ? moreSkills() : null]),
  };
}

export function useMarketplaceInstalled(serverId: string) {
  const allAgents = useMobileWorkspaceSelector((workspace) => workspace.agents);
  const manageSkills = useMobileWorkspaceSelector((workspace) => workspace.canManageAgentSkills(serverId));
  const { loadAgentSkills } = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const agents = useMemo(() => allAgents.filter((agent) => agent.serverId === serverId), [allAgents, serverId]);
  const skillLists = useQueries({
    queries: agents.map((agent) => ({
      ...agentSkillsQuery(queryScope, serverId, agent.id, manageSkills, loadAgentSkills),
      staleTime: 60_000,
      retry: false,
    })),
  });
  const { list: mcpServers } = useMcpServerList(serverId);
  const skillsByAgent = useMemo(() => {
    const byAgent = new Map<string, InstalledSkill[]>();
    agents.forEach((agent, index) => {
      const skills = skillLists[index]?.data;
      if (skills) byAgent.set(agent.id, skills);
    });
    return byAgent;
  }, [agents, skillLists]);
  return useMemo(() => {
    const agentFor = (listingId: string) => agents.find((agent) => agent.marketplaceSource?.listingId === listingId);
    const skillAgentIds = (skillId: string) =>
      [...skillsByAgent].filter(([, skills]) => skills.some((skill) => skill.skillId === skillId)).map(([id]) => id);
    const usableSkillAgentIds = (skillId: string, version: number) =>
      [...skillsByAgent]
        .filter(([, skills]) =>
          skills.some(
            (skill) =>
              skill.skillId === skillId &&
              skill.enabled !== false &&
              skill.state !== "needs-repair" &&
              skill.installedVersion >= version,
          ),
        )
        .map(([id]) => id);
    const installed = (listing: MarketplaceListing): boolean => {
      if (listing.kind === "agent") return agentFor(listing.id) !== undefined;
      if (listing.kind === "skill") return skillAgentIds(listing.id).length > 0;
      if (listing.source === "connector") return listing.connected;
      if (listing.source === "custom") return true;
      return pluginInstalled(listing.plugin, mcpServers.data ?? []);
    };
    return { agents, agentFor, skillAgentIds, usableSkillAgentIds, installed, mcpServers: mcpServers.data ?? null };
  }, [agents, skillsByAgent, mcpServers.data]);
}

export type MarketplaceCatalog = ReturnType<typeof useMarketplaceCatalog>;
export type MarketplaceInstalled = ReturnType<typeof useMarketplaceInstalled>;
