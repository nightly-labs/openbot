import type { MobileTranslate } from "@openbot/i18n/mobile";
import type { MobileAgent, MobileServer } from "@/features/workspace/model/workspace-types";
import type { QuickActionKind } from "./quick-action-choice";

/** The phone remembers more chats than it shows, so a deleted or hidden agent leaves others to show. */
const RECENT_AGENT_LIMIT = 8;

export type QuickActionTarget =
  | { type: "chat"; agentId: string }
  | { type: "routines"; serverId: string }
  | { type: "search" }
  | { type: "share" }
  | { type: "support" };

export interface QuickActionItem {
  id: string;
  title: string;
  /** iOS shows it under the title. Android shows only the title. */
  subtitle: string | null;
  icon: "agent" | "routines" | "search" | "share" | "support";
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
    case "share":
    case "support":
      return target.type;
  }
}

/** An Android shortcut that the user pinned stays after an update, so an unknown ID opens nothing. */
export function readQuickActionId(id: string): QuickActionTarget | null {
  if (id === "search" || id === "share" || id === "support") return { type: id };
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
  kinds: readonly QuickActionKind[];
  recents: readonly RecentAgent[];
  servers: readonly Pick<MobileServer, "id" | "name">[];
  activeServerId: string | null;
  t: MobileTranslate;
}

/**
 * The items that the user chose, in a fixed order. Chats, Schedule and Search need the server that the
 * app shows; Share and Support show also with no server.
 */
export function quickActionItems({ kinds, recents, servers, activeServerId, t }: ItemsInput): QuickActionItem[] {
  const activeServer = servers.find((server) => server.id === activeServerId);
  // With one server, its name tells the user nothing.
  const serverName = (serverId: string) =>
    servers.length > 1 ? (servers.find((server) => server.id === serverId)?.name ?? null) : null;
  // Android refuses a shortcut with no title.
  const chats = recents.filter((recent) => recent.name.trim());
  const chatItem = (recent: RecentAgent | undefined): QuickActionItem[] =>
    recent
      ? [
          {
            id: quickActionId({ type: "chat", agentId: recent.agentId }),
            title: recent.name,
            subtitle: serverName(recent.serverId),
            icon: "agent",
          },
        ]
      : [];
  const items: Record<QuickActionKind, () => QuickActionItem[]> = {
    latestChat: () => (activeServer ? chatItem(chats[0]) : []),
    secondChat: () => (activeServer ? chatItem(chats[1]) : []),
    schedule: () =>
      activeServer
        ? [
            {
              id: quickActionId({ type: "routines", serverId: activeServer.id }),
              title: t("mobile.app.route.schedule"),
              subtitle: serverName(activeServer.id),
              icon: "routines",
            },
          ]
        : [],
    search: () =>
      activeServer
        ? [
            {
              id: quickActionId({ type: "search" }),
              title: t("mobile.app.quickAction.search"),
              subtitle: serverName(activeServer.id),
              icon: "search",
            },
          ]
        : [],
    share: () => [
      { id: quickActionId({ type: "share" }), title: t("mobile.app.quickAction.share"), subtitle: null, icon: "share" },
    ],
    // The menu that holds this item also has Remove App, so it asks the user to tell what is wrong first.
    support: () => [
      {
        id: quickActionId({ type: "support" }),
        title: t("mobile.app.quickAction.support"),
        subtitle: t("mobile.app.quickAction.supportSubtitle"),
        icon: "support",
      },
    ],
  };
  return kinds.flatMap((kind) => items[kind]());
}
