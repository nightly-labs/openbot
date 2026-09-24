import type { AvatarMood } from "@openbot/brand/bloub-avatar-motion";
import type { AgentEvent, DynamicIslandAgentIdentity, TeamRealtimeEvent } from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { DynamicIslandCoordinator } from "@openbot/team-client/dynamic-island-coordinator";
import { userErrorMessage } from "@openbot/user-errors";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";
import { useLiveActivitiesPreference } from "@/features/settings/model/live-activities";
import type { LiveWorkspaceStore } from "@/features/workspace/model/live-workspace-store";
import type { MobileAgent, MobileServer } from "@/features/workspace/model/workspace-types";
import { agentLiveActivity } from "./agent-live-activity";
import {
  type LiveActivityAction,
  onLiveActivityAction,
  resetLiveActivityActions,
  setLiveActivityActions,
} from "./model/live-activity-link";
import {
  type AgentLiveActivityProps,
  liveActivityAgent,
  liveActivityButtons,
  liveActivityMood,
  liveActivityProps,
  liveActivityTapAction,
  UNREAD_AGENT_ROWS,
} from "./model/live-activity-props";
import { LiveActivitySync } from "./model/live-activity-sync";

/** How long content stays current after the app leaves the foreground and stops its connections. */
const STALE_AFTER_BACKGROUND_MS = 5 * 60 * 1000;
/** Streaming replies change the island many times a second. iOS throttles faster updates anyway. */
const PUBLISH_DELAY_MS = 1000;
/**
 * In the background a timer can outlive the app, so changes publish at once. A streamed reply still
 * changes many times a second, and iOS has an update budget. So in one mode, the background
 * publishes at most once in this time.
 */
const BACKGROUND_PUBLISH_INTERVAL_MS = 1000;

interface LiveActivityInput {
  servers: readonly Pick<MobileServer, "id" | "state">[];
  activeServerId: string | null;
  agents: readonly MobileAgent[];
  /** Unread state comes from the host read state, so a chat read on any device clears it. */
  liveState: LiveWorkspaceStore;
  foreground: boolean;
  post: (serverId: string, path: string, body: TeamProtocolV2Json) => Promise<void>;
  loadAgentAvatar: (agentId: string, avatarUrl: string, serverId: string) => Promise<string>;
}

/**
 * Shows the desktop Dynamic Island state as an iOS Live Activity. The desktop island logic reads the
 * same team events, so both show the same event for the same state. Returns the handler for those
 * events. The phone updates the activity only while it runs: iOS stops the app and its connections
 * in the background, so the activity then shows the last state and marks it stale.
 */
export function useLiveActivity({
  servers,
  activeServerId,
  agents,
  liveState,
  foreground,
  post,
  loadAgentAvatar,
}: LiveActivityInput): (serverId: string, event: AgentEvent | TeamRealtimeEvent) => void {
  const live = useMemo(() => {
    const native = agentLiveActivity();
    return native ? { native, coordinator: new DynamicIslandCoordinator(userErrorMessage) } : null;
  }, []);
  const sync = useRef<LiveActivitySync<AgentLiveActivityProps> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Nothing is known before the first event. Publishing then would end the activity from the last launch.
  const received = useRef(false);
  const serverIds = useMemo(() => servers.map((server) => server.id), [servers]);
  const serverOrder = useRef<string[]>([]);
  serverOrder.current = activeServerId
    ? [activeServerId, ...serverIds.filter((id) => id !== activeServerId)]
    : [...serverIds];
  const foregroundRef = useRef(foreground);
  foregroundRef.current = foreground;
  /** Set once when the app leaves the foreground. A new date for each update would make every update differ. */
  const staleDate = useRef<Date | undefined>(undefined);
  const lastPublish = useRef<{ mode: string | null; at: number }>({ mode: null, at: 0 });
  // The connection checks itself when the app returns, and a dead one reports it in the next render.
  // An answer waits for that render, so it is not sent on a connection that only looks online.
  const [resumed, setResumed] = useState(foreground);
  useEffect(() => setResumed(foreground), [foreground]);
  /** Photo file URLs by photo name. `null` while the photo loads or when it failed. */
  const avatars = useRef(new Map<string, string | null>());
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  const loadAvatarRef = useRef(loadAgentAvatar);
  loadAvatarRef.current = loadAgentAvatar;
  const [action, setAction] = useState<LiveActivityAction | null>(null);
  /**
   * Set after sign-out. An avatar load or an answer can finish later, and must not start the
   * activity again with the agents and messages of the removed workspace.
   */
  const disposed = useRef(false);
  /** The command of the approval the activity shows, keyed by server and request. */
  const approvalCommand = useRef<{ key: string; command: string } | null>(null);

  /** `force` skips the background interval, for the stale date that the app must send before iOS suspends it. */
  const publish = useCallback(
    (force = false) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (!live || !received.current || disposed.current) return;
      const preference = useLiveActivitiesPreference.getState();
      // Wait for the stored choice, so a user who turned them off sees no activity at launch.
      if (!preference.ready) return;
      if (!preference.enabled) {
        setLiveActivityActions(null, [], Crypto.randomUUID);
        sync.current ??= new LiveActivitySync(live.native.starter);
        void sync.current.show(null);
        return;
      }
      const presentation = live.coordinator.presentation(serverOrder.current);
      const buttons = liveActivityButtons(presentation);
      approvalCommand.current =
        presentation.mode === "approval" && presentation.item.approval.command
          ? {
              key: requestKey(presentation.serverId, presentation.item.requestId),
              command: presentation.item.approval.command,
            }
          : null;
      const allUnread = presentation.mode === "message" ? unreadAgents(presentation.message.agent.id) : [];
      const unread = allUnread.slice(0, UNREAD_AGENT_ROWS);
      const urls = setLiveActivityActions(
        // Several chats have replies, so a tap opens the agent list and the user chooses one.
        allUnread.length > 1 ? null : liveActivityTapAction(presentation),
        [
          ...buttons.map((button) => button.action),
          ...unread.map((agent) => ({ type: "open-agent" as const, serverId: agent.serverId, agentId: agent.id })),
        ],
        Crypto.randomUUID,
      );
      const props = liveActivityProps(presentation, {
        avatar: avatar(presentation.serverId, liveActivityAgent(presentation), liveActivityMood(presentation)),
        buttons: buttons.flatMap((button, index) => {
          const url = urls[index];
          return url ? [{ label: button.label, prominent: button.prominent, url }] : [];
        }),
        agents: unread.flatMap((agent, index) => {
          const url = urls[buttons.length + index];
          return url
            ? [{ name: agent.name, count: agent.count, avatar: avatar(agent.serverId, agent, "responded"), url }]
            : [];
        }),
        agentCount: allUnread.length,
      });
      const mode = props?.mode ?? null;
      const wait = lastPublish.current.at + BACKGROUND_PUBLISH_INTERVAL_MS - Date.now();
      // A change of mode, such as the end of a turn, is the update that matters most. It never waits.
      if (!force && !foregroundRef.current && mode === lastPublish.current.mode && wait > 0) {
        timer.current = setTimeout(() => publish(), wait);
        return;
      }
      lastPublish.current = { mode, at: Date.now() };
      sync.current ??= new LiveActivitySync(live.native.starter);
      void sync.current.show(props, foregroundRef.current ? undefined : staleDate.current);

      /** The agents with unread replies, the one the island shows first, then the most unread. */
      function unreadAgents(firstId: string) {
        const { unreadAgentIds, unreadCounts } = liveState.get();
        const unread = new Set(unreadAgentIds);
        const servers = new Set(serverOrder.current);
        return agentsRef.current
          .filter((agent) => unread.has(agent.id) && servers.has(agent.serverId))
          .map((agent) => ({
            id: agent.id,
            serverId: agent.serverId,
            name: agent.name,
            avatarSeed: agent.avatarSeed,
            avatarHue: agent.avatarHue,
            avatarUrl: agent.avatarUrl ?? null,
            count: Math.max(1, unreadCounts[agent.id] ?? 1),
          }))
          .sort((a, b) => Number(b.id === firstId) - Number(a.id === firstId) || b.count - a.count);
      }

      function avatar(serverId: string, agent: DynamicIslandAgentIdentity | null, mood: AvatarMood): string {
        if (!live || !agent) return "";
        const keep = () =>
          live.native.removeAvatars(new Set([...avatars.current].filter(([, file]) => file).map(([key]) => key)));
        if (!agent.avatarUrl) {
          // The app avatar without a photo is the bloub. Its picture is drawn once for each face.
          const name = fileName(["bloub", agent.avatarSeed, String(agent.avatarHue ?? ""), mood]);
          const saved = avatars.current.get(name);
          if (saved !== undefined) return saved ?? "";
          let uri: string | null = null;
          try {
            const dataUrl = live.native.renderBloub(agent.avatarSeed, agent.avatarHue, mood);
            uri = dataUrl ? live.native.saveAvatar(name, dataUrl) : null;
          } catch {
            // Without the picture the activity shows the mode symbol.
          }
          avatars.current.set(name, uri);
          keep();
          return uri ?? "";
        }
        const name = fileName([serverId, agent.id, avatarVersion(agent.avatarUrl)]);
        const saved = avatars.current.get(name);
        if (saved !== undefined) return saved ?? "";
        avatars.current.set(name, null);
        void loadAvatarRef
          .current(agent.id, agent.avatarUrl, serverId)
          .then((dataUrl) => {
            if (disposed.current) return;
            const uri = live.native.saveAvatar(name, dataUrl);
            avatars.current.set(name, uri);
            keep();
            if (!uri) return;
            if (!foregroundRef.current) publish();
            else timer.current ??= setTimeout(publish, PUBLISH_DELAY_MS);
          })
          // Without the photo the activity shows the mode symbol.
          .catch(() => undefined);
        return "";
      }
    },
    [live, liveState],
  );

  const schedule = useCallback(() => {
    // In the background iOS can suspend the app before a timer fires, and the last event, such as
    // the end of a turn, would never reach the activity. So the background publishes at once.
    if (!foregroundRef.current) publish();
    else timer.current ??= setTimeout(publish, PUBLISH_DELAY_MS);
  }, [publish]);

  const applyTeamEvent = useCallback(
    (serverId: string, event: AgentEvent | TeamRealtimeEvent) => {
      if (!live || !isAgentEvent(event)) return;
      received.current = true;
      // Unread replies come from the host read state, so no server counts its own arrivals.
      live.coordinator.applyEvent({ serverId, event }, serverId);
      schedule();
    },
    [live, schedule],
  );

  useEffect(() => {
    if (!live) return;
    // The store changes many times in one turn. Reading it here does not re-render the workspace.
    const applyUnread = () => {
      const { unreadAgentIds, unreadCounts } = liveState.get();
      const unread = new Set(unreadAgentIds);
      live.coordinator.retainServers(serverIds);
      for (const serverId of serverIds) {
        live.coordinator.replaceUnreadReplies(
          serverId,
          Object.fromEntries(
            agents
              .filter((agent) => agent.serverId === serverId && unread.has(agent.id))
              .map((agent) => [agent.id, Math.max(1, unreadCounts[agent.id] ?? 1)]),
          ),
        );
      }
      schedule();
    };
    applyUnread();
    let shown = liveState.get();
    return liveState.subscribe(() => {
      const next = liveState.get();
      if (next.unreadAgentIds === shown.unreadAgentIds && next.unreadCounts === shown.unreadCounts) return;
      shown = next;
      applyUnread();
    });
  }, [live, liveState, serverIds, agents, schedule]);

  useEffect(() => (live ? onLiveActivityAction(setAction) : undefined), [live]);

  // A button opens the app, which reconnects first. The answer waits for its server to be online.
  useEffect(() => {
    if (!live || !action || !foreground || !resumed) return;
    const server = servers.find((candidate) => candidate.id === action.serverId);
    if (server && server.state !== "online") return;
    setAction(null);
    // The user removed the server after the activity showed it.
    if (!server) return;
    const perform = () =>
      void performAction(action, post).then(
        () => {
          if (disposed.current) return;
          live.coordinator.resolveAction(action);
          schedule();
        },
        (error: unknown) => {
          if (disposed.current) return;
          const failure = ACTION_FAILURES[action.type];
          Alert.alert(failure.title, userErrorMessage(error, failure.fallback));
        },
      );
    if (action.type !== "respond-approval" || action.decision !== "accept") {
      perform();
      return;
    }
    // iOS can hide the command on a locked screen, and the tap then unlocks straight into the app.
    // So the user sees the command here before the host runs it.
    const shown = approvalCommand.current;
    if (shown?.key !== requestKey(action.serverId, action.requestId)) {
      Alert.alert("Could not send the decision", "The request changed. Open the chat to review it.");
      return;
    }
    Alert.alert("Approve this command?", shown.command, [
      { text: "Cancel", style: "cancel" },
      { text: "Approve", onPress: perform },
    ]);
  }, [live, action, servers, post, schedule, foreground, resumed]);

  // Settings can turn Live Activities off and on. The change shows at once.
  // A subscription, not a hook: the setting must not re-render the workspace.
  useEffect(
    () =>
      useLiveActivitiesPreference.subscribe((state, previous) => {
        if (state.ready !== previous.ready || state.enabled !== previous.enabled) publish();
      }),
    [publish],
  );

  // The app can be suspended at any moment after it leaves the foreground: publish the stale date now.
  useEffect(() => {
    staleDate.current = foreground ? undefined : new Date(Date.now() + STALE_AFTER_BACKGROUND_MS);
    if (!foreground) publish(true);
  }, [foreground, publish]);

  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      // Sign-out removes the workspace. The activity must not keep its agents, messages, and actions.
      resetLiveActivityActions();
      if (!live) return;
      live.native.removeAvatars(new Set());
      sync.current ??= new LiveActivitySync(live.native.starter);
      void sync.current.show(null);
    };
  }, [live]);

  return applyTeamEvent;
}

const ACTION_FAILURES: Record<LiveActivityAction["type"], { title: string; fallback: string }> = {
  "open-agent": { title: "Could not open the chat", fallback: "Try again." },
  "open-failure": { title: "Could not clear the failed task", fallback: "Open the chat and try again." },
  "answer-prompt": { title: "Could not send the answer", fallback: "Open the chat and answer there." },
  "respond-approval": { title: "Could not send the decision", fallback: "Open the request on the desktop." },
};

function performAction(
  action: LiveActivityAction,
  post: (serverId: string, path: string, body: TeamProtocolV2Json) => Promise<void>,
): Promise<void> {
  switch (action.type) {
    case "open-agent":
      return Promise.resolve();
    case "open-failure":
      return post(action.serverId, TEAM_API_ROUTES.agent.failuresAcknowledge(action.agentId), {
        turnId: action.turnId,
      });
    case "answer-prompt":
      return post(action.serverId, TEAM_API_ROUTES.respond.prompt, {
        requestId: action.requestId,
        answers: action.answers,
      });
    case "respond-approval":
      return post(action.serverId, TEAM_API_ROUTES.respond.approval, {
        requestId: action.requestId,
        decision: action.decision,
      });
  }
}

function requestKey(serverId: string, requestId: string | number): string {
  return JSON.stringify([serverId, String(requestId)]);
}

function avatarVersion(avatarUrl: string): string {
  try {
    return new URL(avatarUrl).searchParams.get("v") ?? "";
  } catch {
    // The host sends a URL. Without a version, the photo is not loaded again after a change.
    return "";
  }
}

/** A file name that is different for each different list of parts. */
function fileName(parts: readonly string[]): string {
  return parts
    .map((part) => part.replace(/[^A-Za-z0-9]/gu, (character) => `_${character.codePointAt(0)?.toString(16)}_`))
    .join("-");
}

function isAgentEvent(event: AgentEvent | TeamRealtimeEvent): event is AgentEvent {
  return (
    event.type !== "team-identity" &&
    event.type !== "team-presence" &&
    event.type !== "team-direct-message" &&
    event.type !== "team-direct-typing"
  );
}
