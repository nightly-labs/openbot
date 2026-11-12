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
import { MOBILE_PLUGINS } from "./plugin-catalog.generated";
import { claimedByPlugin, pluginInstalled } from "./plugin-connect";

/** How long a catalog page stays fresh, as the desktop overview cache. */
const CATALOG_FRESH_MS = 5 * 60_000;
/** The pause after the last key press before the catalog is searched, as on the desktop. */
const SEARCH_DEBOUNCE_MS = 220;

function useDebounced(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/**
 * The apps of the server that are not in the plugin catalog, as on the desktop: each connector that an
 * owner or admin can set up from the phone, and each MCP server that the user added. A member reads
 * neither, so a member sees only the plugin apps.
 */
function useServerApps(serverId: string): MarketplaceListing[] {
  const { t } = useText();
  const rows = useConnectorRows(serverId);
  const { list: mcpServers } = useMcpServerList(serverId);
  return useMemo(
    () => [
      ...rows.flatMap(
        (row) => connectorListing(row, t(CONNECTOR_TITLE_KEYS[row.id]), t(CONNECTOR_TAGLINES[row.id])) ?? [],
      ),
      ...(mcpServers.data ?? [])
        .filter((server) => !MOBILE_PLUGINS.some((plugin) => claimedByPlugin(server, plugin)))
        .map(customListing),
    ],
    [rows, mcpServers.data, t],
  );
}

/**
 * The listings of the account service's catalog, with the plugin apps the app ships and the server's own
 * apps. A search and a category go to the catalog, which answers the best matches first; the apps are
 * matched here.
 */
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
  const serverApps = useServerApps(serverId);
  const apiUrl = session?.apiUrl ?? null;
  const search = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS);
  const category = filter.category;
  const listQuery = {
    sort: "installs" as const,
    limit: MARKETPLACE_PAGE_SIZE,
    ...(search ? { query: search } : {}),
    ...(category ? { category } : {}),
  };
  // A page at a time, as the desktop: the next page loads only when the user asks for more.
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
      ...[...serverApps, ...appListings(apiUrl)].filter((app) => matchesQuery(app, search)),
      ...(skills.data?.pages ?? []).flatMap((page) => page.skills.map((skill) => skillListing(apiUrl, skill))),
    ];
  }, [apiUrl, agents.data, skills.data, search, serverApps]);
  const pending =
    (agents.isPending && agents.fetchStatus !== "idle") || (skills.isPending && skills.fetchStatus !== "idle");
  const { fetchNextPage: moreAgents } = agents;
  const { fetchNextPage: moreSkills } = skills;
  // A disabled query keeps its cached pages, so the Apps list must not offer them.
  const agentsMore = showAgents && agents.hasNextPage;
  const skillsMore = showSkills && skills.hasNextPage;
  return {
    listings,
    /** The debounced search, which the listings match. */
    search,
    pending,
    /**
     * A catalog read failed with nothing to show for it. The bundled apps always list, so the listings
     * are never empty and cannot tell this.
     */
    failed: (agents.isError && !agents.data) || (skills.isError && !skills.data),
    refetch: () => Promise.all([agents.refetch(), skills.refetch()]),
    /** The catalog has more agents or skills than the listings show. */
    hasMore: agentsMore || skillsMore,
    loadingMore: agents.isFetchingNextPage || skills.isFetchingNextPage,
    /** The last "Load more" failed. The listings keep the pages read before it. */
    loadMoreFailed: (showAgents && agents.isFetchNextPageError) || (showSkills && skills.isFetchNextPageError),
    loadMore: () => Promise.all([agentsMore ? moreAgents() : null, skillsMore ? moreSkills() : null]),
  };
}

/**
 * What the active server already has from the Marketplace: the agents added from a listing, the skills
 * of each agent, and the MCP servers that a plugin installs as. A member reads no MCP list, so apps
 * show as not installed for a member; a member cannot install them either.
 */
export function useMarketplaceInstalled(serverId: string) {
  const allAgents = useMobileWorkspaceSelector((workspace) => workspace.agents);
  const manageSkills = useMobileWorkspaceSelector((workspace) => workspace.canManageAgentSkills(serverId));
  const { loadAgentSkills } = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const agents = useMemo(() => allAgents.filter((agent) => agent.serverId === serverId), [allAgents, serverId]);
  const skillLists = useQueries({
    queries: agents.map((agent) => ({
      // The agent page reads the same query, so both show the same list.
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
    /** The agents that can try the skill, as on the desktop: this version or newer, on, and not broken. */
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
      if (listing.source === "custom") return listing.server.enabled;
      return pluginInstalled(listing.plugin, mcpServers.data ?? []);
    };
    return { agents, agentFor, skillAgentIds, usableSkillAgentIds, installed, mcpServers: mcpServers.data ?? null };
  }, [agents, skillsByAgent, mcpServers.data]);
}

export type MarketplaceCatalog = ReturnType<typeof useMarketplaceCatalog>;
export type MarketplaceInstalled = ReturnType<typeof useMarketplaceInstalled>;
