import type { InstalledSkill } from "@openbot/contracts/ipc";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { agentSkillsQuery } from "@/features/agents/model/agent-skills-query";
import { useMobileSession, useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useMcpServerList } from "@/features/servers/model/use-server-mcp";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { listMarketplaceAgents, listMarketplaceSkills, MARKETPLACE_PAGE_SIZE } from "../api/marketplace-catalog";
import {
  agentListing,
  appListings,
  type MarketplaceFilter,
  type MarketplaceListing,
  matchesQuery,
  skillListing,
} from "./marketplace-listings";
import { pluginInstalled } from "./plugin-connect";

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
 * The listings of the account service's catalog, with the plugin apps the app ships. A search and a
 * category go to the catalog, which answers the best matches first; the apps are matched here.
 */
export function useMarketplaceCatalog({ query, filter }: { query: string; filter: MarketplaceFilter }) {
  const { session } = useMobileSession();
  const apiUrl = session?.apiUrl ?? null;
  const search = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS);
  const category = filter.category;
  const listQuery = {
    sort: "installs" as const,
    limit: MARKETPLACE_PAGE_SIZE,
    ...(search ? { query: search } : {}),
    ...(category ? { category } : {}),
  };
  const agents = useQuery({
    queryKey: queryKeys.marketplace(apiUrl, "agents", search, category),
    enabled: apiUrl !== null && (filter.kind === null || filter.kind === "agent"),
    staleTime: CATALOG_FRESH_MS,
    queryFn: ({ signal }) => listMarketplaceAgents(apiUrl ?? "", listQuery, signal),
  });
  const skills = useQuery({
    queryKey: queryKeys.marketplace(apiUrl, "skills", search, category),
    enabled: apiUrl !== null && (filter.kind === null || filter.kind === "skill"),
    staleTime: CATALOG_FRESH_MS,
    queryFn: ({ signal }) => listMarketplaceSkills(apiUrl ?? "", listQuery, signal),
  });
  const listings = useMemo(() => {
    if (!apiUrl) return [];
    return [
      ...(agents.data?.agents ?? []).map((agent) => agentListing(apiUrl, agent)),
      ...appListings(apiUrl).filter((app) => matchesQuery(app, search)),
      ...(skills.data?.skills ?? []).map((skill) => skillListing(apiUrl, skill)),
    ];
  }, [apiUrl, agents.data, skills.data, search]);
  const pending =
    (agents.isPending && agents.fetchStatus !== "idle") || (skills.isPending && skills.fetchStatus !== "idle");
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
      return pluginInstalled(listing.plugin, mcpServers.data ?? []);
    };
    return { agents, agentFor, skillAgentIds, usableSkillAgentIds, installed, mcpServers: mcpServers.data ?? null };
  }, [agents, skillsByAgent, mcpServers.data]);
}

export type MarketplaceInstalled = ReturnType<typeof useMarketplaceInstalled>;
