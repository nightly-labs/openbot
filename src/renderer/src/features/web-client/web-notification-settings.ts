import {
  type AgentNotificationLevelsSnapshot,
  agentNotificationLevelMap,
  type ClientAgentSummary,
  type ServerNotificationLevel,
  type ServerSummary,
} from "@openbot/contracts/ipc";
import type {
  NotificationMatrixAgents,
  NotificationMatrixServer,
} from "@openbot/ui/features/settings/NotificationMatrix";
import { createEffect, createMemo, createStore } from "solid-js";
import type { createWebServerNotifications } from "./web-notification-preferences";
import type { WebWorkspaceRuntime } from "./web-runtime";

interface HostLevelsEntry {
  status: "loading" | "failed" | "ready";
  agents: ClientAgentSummary[];
  levels: AgentNotificationLevelsSnapshot | null;
}

export function createWebNotificationSettings(options: {
  visible: () => boolean;
  servers: () => readonly ServerSummary[];
  runtime: Pick<
    WebWorkspaceRuntime,
    "notificationSettings" | "setHostAgentNotificationLevel" | "setOwnServerNotificationLevel" | "updateAgent"
  >;
  openHostId: () => string | null;
  notifications: ReturnType<typeof createWebServerNotifications>;
  setLocalLevel: (hostId: string, level: ServerNotificationLevel) => void;
  setMuted: (hostId: string, muted: boolean, durationMs?: number) => void;
  onLevelsWritten: (hostId: string, levels: AgentNotificationLevelsSnapshot) => void;
}) {
  const [entries, setEntries] = createStore<Record<string, HostLevelsEntry>>({});
  const generations = new Map<string, number>();

  function rememberLevels(hostId: string, levels: AgentNotificationLevelsSnapshot | null): void {
    setEntries((draft) => {
      const entry = draft[hostId];
      if (entry) entry.levels = levels;
    });
    options.notifications.setSyncedLevel(hostId, levels?.server ?? null);
  }

  async function load(hostId: string): Promise<void> {
    const read = options.runtime.notificationSettings;
    const generation = (generations.get(hostId) ?? 0) + 1;
    generations.set(hostId, generation);
    setEntries((draft) => {
      draft[hostId] = { status: "loading", agents: draft[hostId]?.agents ?? [], levels: draft[hostId]?.levels ?? null };
    });
    try {
      if (!read) return markFailed(hostId, generation);
      const { agents, levels } = await read(hostId);
      if (generations.get(hostId) !== generation) return;
      setEntries((draft) => {
        draft[hostId] = { status: "ready", agents, levels };
      });
      options.notifications.setSyncedLevel(hostId, levels?.server ?? null);
    } catch {
      markFailed(hostId, generation);
    }
  }

  function markFailed(hostId: string, generation: number): void {
    if (generations.get(hostId) !== generation) return;
    setEntries((draft) => {
      const entry = draft[hostId];
      if (entry) entry.status = "failed";
    });
  }

  const onlineHostIds = createMemo(() =>
    options.visible()
      ? options
          .servers()
          .filter((server) => server.state === "online")
          .map((server) => server.id)
          .join("\n")
      : "",
  );
  createEffect(onlineHostIds, (ids, previous) => {
    if (!ids) return;
    const before = new Set(previous ? previous.split("\n") : []);
    for (const hostId of ids.split("\n")) if (!before.has(hostId)) void load(hostId);
  });

  function keepsLevels(hostId: string): boolean | null {
    const entry = entries[hostId];
    if (entry?.status !== "ready") return null;
    return entry.levels !== null;
  }

  function matrixAgents(hostId: string): NotificationMatrixAgents {
    const entry = entries[hostId];
    if (!entry || entry.status === "loading") return { status: "loading" };
    if (entry.status === "failed") return { status: "failed" };
    const levels = entry.levels;
    if (!levels) return { status: "unsupported" };
    const own = agentNotificationLevelMap(levels);
    const open = hostId === options.openHostId();
    return {
      status: "ready",
      agents: entry.agents
        .filter((agent) => agent.notifications || open)
        .map((agent) => ({
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
    options.servers().map((server) => ({
      id: server.id,
      name: server.name,
      logoUrl: server.logoUrl,
      level: server.notificationLevel,
      muted: server.notificationsMuted,
      mutedUntil: server.notificationsMutedUntil,
      offline: server.state !== "online",
      deviceOnly: keepsLevels(server.id) === false,
      agents: matrixAgents(server.id),
    })),
  );

  async function setServerLevel(hostId: string, level: ServerNotificationLevel): Promise<void> {
    const write = options.runtime.setOwnServerNotificationLevel;
    if (keepsLevels(hostId) !== false && write) rememberLevels(hostId, await write(hostId, level));
    options.setLocalLevel(hostId, level);
  }

  async function setAgentLevel(hostId: string, agentId: string, level: ServerNotificationLevel | null): Promise<void> {
    const write = options.runtime.setHostAgentNotificationLevel;
    if (!write) return;
    const levels = await write(hostId, { agentId, level });
    rememberLevels(hostId, levels);
    options.onLevelsWritten(hostId, levels);
    const agent = entries[hostId]?.agents.find((candidate) => candidate.id === agentId);
    if (level === null || !agent || agent.notifications || hostId !== options.openHostId()) return;
    await options.runtime.updateAgent({ agentId, notifications: true });
    setEntries((draft) => {
      const turnedOn = draft[hostId]?.agents.find((candidate) => candidate.id === agentId);
      if (turnedOn) turnedOn.notifications = true;
    });
  }

  async function mute(hostId: string, durationMs: number | null): Promise<void> {
    if (durationMs === null) options.setMuted(hostId, true);
    else options.setMuted(hostId, true, durationMs);
  }

  async function unmute(hostId: string): Promise<void> {
    options.setMuted(hostId, false);
  }

  return {
    matrixServers,
    setServerLevel,
    setAgentLevel,
    mute,
    unmute,
    retry: (hostId: string) => void load(hostId),
    applyLevels: rememberLevels,
  };
}

export type WebNotificationSettings = ReturnType<typeof createWebNotificationSettings>;
