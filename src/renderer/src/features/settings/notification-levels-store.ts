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

interface ServerLevelsEntry {
  status: "loading" | "failed" | "ready";
  agents: ClientAgentSummary[];
  levels: AgentNotificationLevelsSnapshot | null;
}

function serverOffline(server: ServerSummary): boolean {
  return server.kind === "remote" && server.state !== "online";
}

function serverKeepsLevels(server: ServerSummary): boolean {
  return serverSupportsCapability(server, AGENT_NOTIFICATION_LEVELS_CAPABILITY);
}

export function createNotificationLevelsStore(options: {
  visible: () => boolean;
  servers: () => readonly ServerSummary[];
}) {
  const [entries, setEntries] = createStore<Record<string, ServerLevelsEntry>>({});
  const generations = new Map<string, number>();

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
        detail: agent.title,
        avatarSeed: agent.avatarSeed,
        avatarHue: agent.avatarHue,
        avatarUrl: agent.avatarUrl,
        level: own.get(agent.id) ?? null,
      })),
    };
  }

  const matrixServers = createMemo((): NotificationMatrixServer[] =>
    [
      ...options.servers().filter((server) => server.kind === "local"),
      ...options.servers().filter((server) => server.kind === "remote"),
    ].map((server) => ({
      id: server.id,
      name: server.name,
      logoUrl: server.logoUrl,
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
    const port = settingsPort().agent;
    const levels = await port.setAgentNotificationLevel({ agentId, level }, serverId);
    setEntries((draft) => {
      const entry = draft[serverId];
      if (entry) entry.levels = levels;
    });
    const agent = entries[serverId]?.agents.find((candidate) => candidate.id === agentId);
    if (level === null || !agent || agent.notifications) return;
    await port.updateAgent({ agentId, notifications: true }, serverId);
    setEntries((draft) => {
      const turnedOn = draft[serverId]?.agents.find((candidate) => candidate.id === agentId);
      if (turnedOn) turnedOn.notifications = true;
    });
  }

  function retry(serverId: string): void {
    const server = options.servers().find((candidate) => candidate.id === serverId);
    if (server) void load(server);
  }

  return { matrixServers, setAgentLevel, retry };
}

export type NotificationLevelsStore = ReturnType<typeof createNotificationLevelsStore>;
