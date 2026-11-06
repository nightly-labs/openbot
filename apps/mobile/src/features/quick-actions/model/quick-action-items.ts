import type { MobileTranslate } from "@openbot/i18n/mobile";
import type { MobileAgent, MobileServer } from "@/features/workspace/model/workspace-types";

/** iOS shows four quick actions, so two recent agents leave room for Routines and Search. */
const RECENT_AGENT_ITEMS = 2;
/** The phone remembers more chats than it shows, so a deleted or hidden agent leaves others to show. */
const RECENT_AGENT_LIMIT = 8;

export type QuickActionTarget =
  | { type: "chat"; agentId: string }
  | { type: "routines"; serverId: string }
  | { type: "search" };

export interface QuickActionItem {
  id: string;
  title: string;
  /** iOS shows it under the title. Android shows only the title. */
  subtitle: string | null;
  icon: "agent" | "routines" | "search";
}

/** A chat that this phone opened. Its last name shows while its server is not connected. */
export interface RecentAgent {
  serverId: string;
  agentId: string;
  name: string;
}

function quickActionId(target: QuickActionTarget): string {
  switch (target.type) {
    case "chat":
      return `chat:${target.agentId}`;
    case "routines":
      return `routines:${target.serverId}`;
    case "search":
      return "search";
  }
}

/** An Android shortcut that the user pinned stays after an update, so an unknown ID opens nothing. */
export function readQuickActionId(id: string): QuickActionTarget | null {
  if (id === "search") return { type: "search" };
  const separator = id.indexOf(":");
  const value = id.slice(separator + 1);
  if (separator < 0 || !value) return null;
  switch (id.slice(0, separator)) {
    case "chat":
      return { type: "chat", agentId: value };
    case "routines":
      return { type: "routines", serverId: value };
    default:
      return null;
  }
}

/** Puts an opened chat first. */
export function withOpenedAgent(
  recents: readonly RecentAgent[],
  agent: Pick<MobileAgent, "id" | "serverId" | "name">,
): RecentAgent[] {
  return [
    { serverId: agent.serverId, agentId: agent.id, name: agent.name },
    ...recents.filter((recent) => recent.serverId !== agent.serverId || recent.agentId !== agent.id),
  ].slice(0, RECENT_AGENT_LIMIT);
}

interface WorkspaceView {
  servers: readonly Pick<MobileServer, "id" | "state">[];
  agents: readonly Pick<MobileAgent, "id" | "serverId" | "name">[];
  hiddenIds: (serverId: string) => readonly string[];
}

/**
 * Removes the chats that the app icon must not show, and takes the current names. A hidden chat and a
 * chat of a server that the account left go at once. An online server has loaded all its agents, so an
 * agent that it does not list was deleted. A server that is not online keeps its chats.
 */
export function currentRecentAgents(
  recents: readonly RecentAgent[],
  { servers, agents, hiddenIds }: WorkspaceView,
): RecentAgent[] {
  const serverStates = new Map(servers.map((server) => [server.id, server.state]));
  const current: RecentAgent[] = [];
  for (const recent of recents) {
    const state = serverStates.get(recent.serverId);
    if (state === undefined || hiddenIds(recent.serverId).includes(recent.agentId)) continue;
    const agent = agents.find((item) => item.serverId === recent.serverId && item.id === recent.agentId);
    if (agent) current.push(agent.name === recent.name ? recent : { ...recent, name: agent.name });
    else if (state !== "online") current.push(recent);
  }
  return current;
}

interface ItemsInput {
  recents: readonly RecentAgent[];
  servers: readonly Pick<MobileServer, "id" | "name">[];
  activeServerId: string | null;
  t: MobileTranslate;
}

/** The recent agents come first. Routines and Search use the server that the app shows. */
export function quickActionItems({ recents, servers, activeServerId, t }: ItemsInput): QuickActionItem[] {
  const activeServer = servers.find((server) => server.id === activeServerId);
  if (!activeServer) return [];
  // With one server, its name tells the user nothing.
  const serverName = (serverId: string) =>
    servers.length > 1 ? (servers.find((server) => server.id === serverId)?.name ?? null) : null;
  return [
    // Android refuses a shortcut with no title.
    ...recents
      .filter((recent) => recent.name.trim())
      .slice(0, RECENT_AGENT_ITEMS)
      .map(
        (recent): QuickActionItem => ({
          id: quickActionId({ type: "chat", agentId: recent.agentId }),
          title: recent.name,
          subtitle: serverName(recent.serverId),
          icon: "agent",
        }),
      ),
    {
      id: quickActionId({ type: "routines", serverId: activeServer.id }),
      title: t("mobile.app.route.schedule"),
      subtitle: serverName(activeServer.id),
      icon: "routines",
    },
    {
      id: quickActionId({ type: "search" }),
      title: t("mobile.app.quickAction.search"),
      subtitle: serverName(activeServer.id),
      icon: "search",
    },
  ];
}
