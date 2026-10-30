import {
  type AgentNotificationLevelsSnapshot,
  agentNotificationLevelMap,
  type ClientAgentSummary,
  type ServerNotificationLevel,
  type ServerSummary,
} from "@openbot/contracts/ipc";
import { AGENT_NOTIFICATION_LEVELS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-notification-levels-v1";
import type {
  NotificationMatrixAgents,
  NotificationMatrixServer,
} from "@openbot/ui/features/settings/NotificationMatrix";
import { createEffect, createMemo, createStore, onSettled } from "solid-js";
import { serverSupportsCapability } from "../servers/server-capabilities";
import { settingsPort } from "./settings-port";

/** What the Notifications tab read from one server. */
interface ServerLevelsEntry {
  status: "loading" | "failed" | "ready";
  agents: ClientAgentSummary[];
  levels: AgentNotificationLevelsSnapshot | null;
}

/** A joined server must be online to answer. The server of this computer always answers. */
function serverOffline(server: ServerSummary): boolean {
  return server.kind === "remote" && server.state !== "online";
}

/** The server keeps the levels of the user for all devices: this computer, or a host with the capability. */
function serverKeepsLevels(server: ServerSummary): boolean {
  return serverSupportsCapability(server, AGENT_NOTIFICATION_LEVELS_CAPABILITY);
}

/**
 * The agents and the user's own levels of each server, for Settings › Notifications. The tab reads
 * them each time it shows, because another device of the user can change them, and reads a server
 * again when it comes online.
 */
export function createNotificationLevelsStore(options: {
  visible: () => boolean;
  servers: () => readonly ServerSummary[];
}) {
  const [entries, setEntries] = createStore<Record<string, ServerLevelsEntry>>({});
  /** Bumped for each read of a server, so an answer of an earlier read is dropped. */
  const generations = new Map<string, number>();

  // A change on another device of the user, such as the phone, shows at once.
  onSettled(() =>
    settingsPort().agent.onScopedEvent((scoped) => {
      if (scoped.event.type !== "agent-notification-levels-changed") return;
      const levels = { server: scoped.event.server, agents: scoped.event.agents };
      setEntries((draft) => {
        const entry = draft[scoped.serverId];
        if (entry) entry.levels = levels;
      });
    }),
  );

  async function load(server: ServerSummary): Promise<void> {
    const serverId = server.id;
    const generation = (generations.get(serverId) ?? 0) + 1;
    generations.set(serverId, generation);
    setEntries((draft) => {
      draft[serverId] = { status: "loading", agents: draft[serverId]?.agents ?? [], levels: null };
    });
    const port = settingsPort().agent;
    try {
      const [agents, levels] = await Promise.all([
        port.listAgents(serverId),
        serverKeepsLevels(server) ? port.listAgentNotificationLevels(serverId) : Promise.resolve(null),
      ]);
      if (generations.get(serverId) !== generation) return;
      setEntries((draft) => {
        draft[serverId] = { status: "ready", agents, levels };
      });
    } catch {
      if (generations.get(serverId) !== generation) return;
      setEntries((draft) => {
        draft[serverId] = { status: "failed", agents: [], levels: null };
      });
    }
  }

  // The online servers while the tab shows. A server that joins the list is read; closing the tab
  // empties the list, so the next opening reads every server again.
  const onlineServerIds = createMemo(() =>
    options.visible()
      ? options
          .servers()
          .filter((server) => !serverOffline(server))
          .map((server) => server.id)
          .join("\n")
      : "",
  );
  createEffect(onlineServerIds, (ids, previous) => {
    if (!ids) return;
    const before = new Set(previous ? previous.split("\n") : []);
    for (const serverId of ids.split("\n")) {
      if (before.has(serverId)) continue;
      const server = options.servers().find((candidate) => candidate.id === serverId);
      if (server) void load(server);
    }
  });

  function matrixAgents(server: ServerSummary): NotificationMatrixAgents {
    if (server.kind === "remote" && !serverKeepsLevels(server)) return { status: "unsupported" };
    const entry = entries[server.id];
    if (!entry || entry.status === "loading") return { status: "loading" };
    if (entry.status === "failed") return { status: "failed" };
    const own = entry.levels ? agentNotificationLevelMap(entry.levels) : new Map<string, ServerNotificationLevel>();
    return {
      status: "ready",
      agents: entry.agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        // Only the short title: a long description would change the height of the row.
        detail: agent.title,
        sharedOff: !agent.notifications,
        level: own.get(agent.id) ?? null,
      })),
    };
  }

  /** The rows of the matrix, in the order of the server rail: this computer first. */
  const matrixServers = createMemo((): NotificationMatrixServer[] =>
    [
      ...options.servers().filter((server) => server.kind === "local"),
      ...options.servers().filter((server) => server.kind === "remote"),
    ].map((server) => ({
      id: server.id,
      name: server.name,
      level: server.notificationLevel,
      muted: server.notificationsMuted,
      mutedUntil: server.notificationsMutedUntil,
      offline: serverOffline(server),
      deviceOnly: !serverKeepsLevels(server),
      agents: matrixAgents(server),
    })),
  );

  async function setAgentLevel(
    serverId: string,
    agentId: string,
    level: ServerNotificationLevel | null,
  ): Promise<void> {
    const levels = await settingsPort().agent.setAgentNotificationLevel({ agentId, level }, serverId);
    setEntries((draft) => {
      const entry = draft[serverId];
      if (entry) entry.levels = levels;
    });
  }

  function retry(serverId: string): void {
    const server = options.servers().find((candidate) => candidate.id === serverId);
    if (server) void load(server);
  }

  return { matrixServers, setAgentLevel, retry };
}

export type NotificationLevelsStore = ReturnType<typeof createNotificationLevelsStore>;
