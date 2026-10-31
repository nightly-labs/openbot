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

/** What the notification settings read from one host. `levels` null: the host keeps no levels. */
interface HostLevelsEntry {
  status: "loading" | "failed" | "ready";
  agents: ClientAgentSummary[];
  levels: AgentNotificationLevelsSnapshot | null;
}

/**
 * The agents and the user's own levels of each host, for the notification settings of the web
 * client. A host with `agent-notification-levels-v1` keeps the server level for all devices of the
 * user; this browser keeps its own level as the fallback, and as the level of an older host.
 */
export function createWebNotificationSettings(options: {
  visible: () => boolean;
  /** The hosts as the rail shows them, with the level and the mute of each. */
  servers: () => readonly ServerSummary[];
  runtime: Pick<
    WebWorkspaceRuntime,
    "notificationSettings" | "setHostAgentNotificationLevel" | "setOwnServerNotificationLevel" | "updateAgent"
  >;
  /** The host that this tab has open. Only it takes a change of an agent. */
  openHostId: () => string | null;
  notifications: ReturnType<typeof createWebServerNotifications>;
  /** Sets the level of this browser, and asks for the notification permission. */
  setLocalLevel: (hostId: string, level: ServerNotificationLevel) => void;
  setMuted: (hostId: string, muted: boolean, durationMs?: number) => void;
}) {
  const [entries, setEntries] = createStore<Record<string, HostLevelsEntry>>({});
  /** Bumped for each read of a host, so an answer of an earlier read is dropped. */
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

  // The online hosts while the settings show. A host that joins the list is read; closing the
  // settings empties the list, so the next opening reads every host again.
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

  /** Whether the host keeps the levels of the user. Unknown until its first read. */
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
    // An agent turned off for everyone can turn on again only on the open host, so a level of its
    // own on another host would save and stay silent. Such an agent does not show there.
    const open = hostId === options.openHostId();
    return {
      status: "ready",
      agents: entry.agents
        .filter((agent) => agent.notifications || open)
        .map((agent) => ({
          id: agent.id,
          name: agent.name,
          // Only the short title: a long description would change the height of the row.
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

  /**
   * Writes the level to a host that keeps it, for all devices of the user. This browser keeps the
   * level too, as the fallback while the host does not answer.
   */
  async function setServerLevel(hostId: string, level: ServerNotificationLevel): Promise<void> {
    const write = options.runtime.setOwnServerNotificationLevel;
    // A host that has not answered yet is asked too; an older host then refuses the write.
    if (keepsLevels(hostId) !== false && write) rememberLevels(hostId, await write(hostId, level));
    options.setLocalLevel(hostId, level);
  }

  /**
   * Writes the level of the user for one agent. An agent that a member turned off for every member,
   * with the agent switch of earlier versions, stays silent at each level, and no control shows that
   * switch now. So a level of its own also turns the agent on again, on the open host: only it takes
   * a change of an agent.
   */
  async function setAgentLevel(hostId: string, agentId: string, level: ServerNotificationLevel | null): Promise<void> {
    const write = options.runtime.setHostAgentNotificationLevel;
    if (!write) return;
    rememberLevels(hostId, await write(hostId, { agentId, level }));
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
    /** The levels that a host sent after a change on another device of the user. */
    applyLevels: rememberLevels,
  };
}

export type WebNotificationSettings = ReturnType<typeof createWebNotificationSettings>;
