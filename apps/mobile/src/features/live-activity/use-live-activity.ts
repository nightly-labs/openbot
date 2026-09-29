import type { AgentEvent, DynamicIslandAgentIdentity, TeamRealtimeEvent } from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  LIVE_ACTIVITY_PUSH_ROUTES,
  type LiveActivityPushRegistration,
} from "@openbot/contracts/team-protocol/live-activity-push-v1";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import type { MobileTextKey, MobileTranslate } from "@openbot/i18n/mobile";
import { DynamicIslandCoordinator } from "@openbot/team-client/dynamic-island-coordinator";
import {
  type AgentLiveActivityProps,
  LIVE_ACTIVITY_LIST_URL,
  LIVE_ACTIVITY_MOODS,
  type LiveActivityAction,
  type LiveActivityMood,
  liveActivityBloubFile,
  liveActivityFileName,
  liveActivityIslandText,
  liveActivityView,
} from "@openbot/team-client/live-activity-props";
import { encodeLiveActivityBytes } from "@openbot/team-client/live-activity-seal";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";
import { getBloubAvatarColor } from "@/features/agents/model/bloub-activity";
import { useLiveActivitiesPreference } from "@/features/settings/model/live-activities";
import type { LiveWorkspaceStore } from "@/features/workspace/model/live-workspace-store";
import type { MobileAgent, MobileServer } from "@/features/workspace/model/workspace-types";
import { currentLocale, currentText } from "@/shared/lib/text";
import { agentLiveActivity } from "./agent-live-activity";
import type { AgentLiveActivityNative } from "./agent-live-activity.types";
import { loadLiveActivitySecret, resetLiveActivitySecret } from "./model/live-activity-keys";
import {
  type LiveActivityRequest,
  onLiveActivityAction,
  resetLiveActivityActions,
  setLiveActivityLinkKeys,
} from "./model/live-activity-link";
import { LiveActivitySync } from "./model/live-activity-sync";

/**
 * How long content stays current after the app leaves the foreground. A host that sends updates
 * moves the date on with each one. Without them, the content then looks out of date.
 */
const STALE_AFTER_BACKGROUND_MS = 5 * 60 * 1000;
/** Streaming replies change the island many times a second. iOS throttles faster updates anyway. */
const PUBLISH_DELAY_MS = 1000;
/**
 * In the background a timer can outlive the app, so changes publish at once. A streamed reply still
 * changes many times a second, and iOS has an update budget. So in one mode, the background
 * publishes at most once in this time.
 */
const BACKGROUND_PUBLISH_INTERVAL_MS = 1000;
/** Pictures drawn between two pauses, so a long agent list does not stop the interface. */
const BLOUBS_PER_PAUSE = 4;

interface LiveActivityInput {
  servers: readonly Pick<MobileServer, "id" | "state">[];
  activeServerId: string | null;
  agents: readonly MobileAgent[];
  /** Unread state comes from the host read state, so a chat read on any device clears it. */
  liveState: LiveWorkspaceStore;
  foreground: boolean;
  post: (serverId: string, path: string, body: TeamProtocolV2Json) => Promise<void>;
  loadAgentAvatar: (agentId: string, avatarUrl: string, serverId: string) => Promise<string>;
  /** Whether the host can update the activity while iOS suspends the app. */
  supportsPush: (serverId: string) => boolean;
}

/**
 * Shows the desktop Dynamic Island state as an iOS Live Activity. The desktop island logic reads the
 * same team events, so both show the same event for the same state. Returns the handler for those
 * events. The phone updates the activity while it runs. iOS then suspends it and its connections,
 * so the phone gives the active host the push token of the activity, and that host updates it
 * through Apple with content sealed for this phone.
 */
export function useLiveActivity({
  servers,
  activeServerId,
  agents,
  liveState,
  foreground,
  post,
  loadAgentAvatar,
  supportsPush,
}: LiveActivityInput): (serverId: string, event: AgentEvent | TeamRealtimeEvent) => void {
  const live = useMemo(() => {
    const native = agentLiveActivity();
    return native
      ? { native, coordinator: new DynamicIslandCoordinator(() => liveActivityIslandText(currentText().t)) }
      : null;
  }, []);
  const sync = useRef<LiveActivitySync<AgentLiveActivityProps> | null>(null);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ value: string; action: Uint8Array } | null>(null);
  const secretRef = useRef(secret);
  secretRef.current = secret;
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
  /** Picture file names by picture name. `null` while the picture loads or when it failed. */
  const avatars = useRef(new Map<string, string | null>());
  /** The photo files by photo name, which the host names in its updates. */
  const [photos, setPhotos] = useState<Readonly<Record<string, string>>>({});
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  const loadAvatarRef = useRef(loadAgentAvatar);
  loadAvatarRef.current = loadAgentAvatar;
  // `publish` loads photos through this, and the photo loader publishes, so neither depends on the other.
  const loadPhotoRef = useRef<(serverId: string, agentId: string, avatarUrl: string) => void>(() => undefined);
  const postRef = useRef(post);
  postRef.current = post;
  const [request, setRequest] = useState<LiveActivityRequest | null>(null);
  /**
   * Set after sign-out. An avatar load or an answer can finish later, and must not start the
   * activity again with the agents and messages of the removed workspace.
   */
  const disposed = useRef(false);
  /** The host that has the push token, and what it has. */
  const registered = useRef<{ serverId: string; key: string } | null>(null);

  const syncFor = useCallback((native: AgentLiveActivityNative) => {
    sync.current ??= new LiveActivitySync(native.starter, (token) => {
      if (!disposed.current) setPushToken(token);
    });
    return sync.current;
  }, []);

  /** The number of pictures when old files were last deleted. */
  const keptAvatars = useRef(0);
  const keepAvatars = useCallback(() => {
    keptAvatars.current = avatars.current.size;
    live?.native.removeAvatars(new Set([...avatars.current.values()].filter((file) => file !== null)));
  }, [live]);

  /** The file of a drawn bloub. It draws the picture the first time. */
  const bloubFile = useCallback(
    (agent: Pick<DynamicIslandAgentIdentity, "avatarSeed" | "avatarHue">, mood: LiveActivityMood): string => {
      if (!live) return "";
      const file = liveActivityBloubFile(agent.avatarSeed, agent.avatarHue, mood);
      const saved = avatars.current.get(file);
      if (saved !== undefined) return saved ?? "";
      let written: string | null = null;
      try {
        if (live.native.hasAvatar(file)) written = file;
        else {
          const dataUrl = live.native.renderBloub(agent.avatarSeed, agent.avatarHue, mood);
          const base = liveActivityFileName(["bloub", agent.avatarSeed, String(agent.avatarHue ?? ""), mood]);
          written = dataUrl ? live.native.saveAvatar(base, dataUrl) : null;
        }
      } catch {
        // Without the picture the activity shows the mode symbol.
      }
      avatars.current.set(file, written);
      return written ?? "";
    },
    [live],
  );

  /** The `force` skips the background interval, for the stale date that the app must send before iOS suspends it. */
  const publish = useCallback(
    (force = false) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (!live || !received.current || disposed.current) return;
      const preference = useLiveActivitiesPreference.getState();
      // Wait for the stored choice, so a user who turned them off sees no activity at launch.
      if (!preference.ready) return;
      if (!preference.enabled) {
        void syncFor(live.native).show(null);
        return;
      }
      // The buttons need the keys. Their load publishes again.
      const actionKey = secretRef.current?.action;
      if (!actionKey) return;
      const presentation = live.coordinator.presentation(serverOrder.current);
      const { unreadAgentIds, unreadCounts } = liveState.get();
      const unread = new Set(unreadAgentIds);
      const servers = new Set(serverOrder.current);
      const props = liveActivityView(presentation, {
        t: currentText().t,
        agentColor: getBloubAvatarColor,
        avatar,
        unreadAgents: agentsRef.current
          .filter((agent) => unread.has(agent.id) && servers.has(agent.serverId))
          .map((agent) => ({
            id: agent.id,
            serverId: agent.serverId,
            name: agent.name,
            avatarSeed: agent.avatarSeed,
            avatarHue: agent.avatarHue,
            avatarUrl: agent.avatarUrl ?? null,
            count: Math.max(1, unreadCounts[agent.id] ?? 1),
          })),
        actionKey,
      });
      if (avatars.current.size !== keptAvatars.current) keepAvatars();
      const mode = props?.mode ?? null;
      const wait = lastPublish.current.at + BACKGROUND_PUBLISH_INTERVAL_MS - Date.now();
      // A change of mode, such as the end of a turn, is the update that matters most. It never waits.
      if (!force && !foregroundRef.current && mode === lastPublish.current.mode && wait > 0) {
        timer.current = setTimeout(() => publish(), wait);
        return;
      }
      lastPublish.current = { mode, at: Date.now() };
      void syncFor(live.native).show(props, foregroundRef.current ? undefined : staleDate.current);

      function avatar(serverId: string, agent: DynamicIslandAgentIdentity, mood: LiveActivityMood): string {
        if (!live) return "";
        // The app avatar without a photo is the bloub. Its picture is drawn once for each face.
        if (!agent.avatarUrl) return bloubFile(agent, mood);
        const name = photoName(serverId, agent.id, agent.avatarUrl);
        const saved = avatars.current.get(name);
        if (saved !== undefined) return saved ?? "";
        loadPhotoRef.current(serverId, agent.id, agent.avatarUrl);
        return "";
      }
    },
    [live, liveState, syncFor, bloubFile, keepAvatars],
  );

  /** Loads an agent photo into the App Group, then publishes again with it. */
  const loadPhoto = useCallback(
    (serverId: string, agentId: string, avatarUrl: string) => {
      if (!live) return;
      const name = photoName(serverId, agentId, avatarUrl);
      if (avatars.current.has(name)) return;
      avatars.current.set(name, null);
      void loadAvatarRef
        .current(agentId, avatarUrl, serverId)
        .then((dataUrl) => {
          if (disposed.current) return;
          const file = live.native.saveAvatar(name, dataUrl);
          avatars.current.set(name, file);
          keepAvatars();
          if (!file) return;
          setPhotos((current) => ({ ...current, [name]: file }));
          if (!foregroundRef.current) publish();
          else timer.current ??= setTimeout(publish, PUBLISH_DELAY_MS);
        })
        // Without the photo the activity shows the mode symbol.
        .catch(() => undefined);
    },
    [live, keepAvatars, publish],
  );
  loadPhotoRef.current = loadPhoto;

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

  // The keys seal host updates and sign the buttons. The widget gets its two keys in its layout.
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    void loadLiveActivitySecret().then(
      ({ secret: value, keys }) => {
        if (cancelled || disposed.current) return;
        const { t } = currentText();
        live.native.setSealKeys(
          { seal: encodeLiveActivityBytes(keys.seal), tag: encodeLiveActivityBytes(keys.tag) },
          unreadableProps(t),
        );
        setSecret({ value: encodeLiveActivityBytes(value), action: keys.action });
        setLiveActivityLinkKeys(keys);
      },
      // Without the keys the activity has no buttons, and only this app updates it.
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [live]);

  useEffect(() => {
    if (secret) publish();
  }, [secret, publish]);

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

  useEffect(() => (live ? onLiveActivityAction(setRequest) : undefined), [live]);

  // A button opens the app, which reconnects first. The answer waits for its server to be online.
  useEffect(() => {
    if (!live || !request || !foreground || !resumed) return;
    const { action, command } = request;
    const server = servers.find((candidate) => candidate.id === action.serverId);
    if (server && server.state !== "online") return;
    setRequest(null);
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
          const { t, errorMessage } = currentText();
          const [title, fallback] = ACTION_FAILURES[action.type];
          Alert.alert(t(title), errorMessage(error, t(fallback)));
        },
      );
    if (action.type !== "respond-approval" || action.decision !== "accept") {
      perform();
      return;
    }
    // iOS can hide the command on a locked screen, and the tap then unlocks straight into the app.
    // So the user sees the command here before the host runs it. The signed link carries it.
    const { t } = currentText();
    if (!command) {
      Alert.alert(t("mobile.liveActivity.error.decision"), t("mobile.liveActivity.requestChanged"));
      return;
    }
    Alert.alert(t("mobile.liveActivity.confirm.title"), command, [
      { text: t("mobile.liveActivity.confirm.cancel"), style: "cancel" },
      { text: t("mobile.liveActivity.confirm.approve"), onPress: perform },
    ]);
  }, [live, request, servers, post, schedule, foreground, resumed]);

  // Settings can turn Live Activities off and on. The change shows at once.
  // A subscription, not a hook: the setting must not re-render the workspace.
  const [enabled, setEnabled] = useState(() => {
    const preference = useLiveActivitiesPreference.getState();
    return preference.ready && preference.enabled;
  });
  useEffect(
    () =>
      useLiveActivitiesPreference.subscribe((state, previous) => {
        if (state.ready !== previous.ready || state.enabled !== previous.enabled) {
          setEnabled(state.ready && state.enabled);
          publish();
        }
      }),
    [publish],
  );

  // The app can be suspended at any moment after it leaves the foreground: publish the stale date now.
  useEffect(() => {
    staleDate.current = foreground ? undefined : new Date(Date.now() + STALE_AFTER_BACKGROUND_MS);
    // The host could update or end the activity while the app was away. Show the app state again.
    if (foreground) sync.current?.forget();
    publish(!foreground);
  }, [foreground, publish]);

  // The active host gets the push token while the app runs, and a flag when the app goes away.
  // A server that goes offline keeps the token: in the background the app stops its connections,
  // and that is when the host needs the token. The request then fails, and the host also counts the
  // closed connection as away.
  const pushServerId =
    live && enabled && pushToken && secret && activeServerId && supportsPush(activeServerId) ? activeServerId : null;
  // The request needs the connection. When it comes back, the phone tells the host again.
  const pushServerOnline = servers.some((server) => server.id === pushServerId && server.state === "online");
  useEffect(() => {
    if (!live) return;
    const previous = registered.current;
    if (previous && previous.serverId !== pushServerId) {
      registered.current = null;
      // The host also forgets it when the session ends, so a failed request leaves nothing behind.
      void post(previous.serverId, LIVE_ACTIVITY_PUSH_ROUTES.remove, {}).catch(() => undefined);
    }
    if (!pushServerId || !pushServerOnline || !pushToken || !secret) return;
    let cancelled = false;
    const serverAgents = agentsRef.current.filter((agent) => agent.serverId === pushServerId);
    void (async () => {
      // The host names only pictures that exist, so the phone draws each face before the host needs it.
      let drawn = 0;
      for (const agent of serverAgents) {
        if (agent.avatarUrl) {
          loadPhotoRef.current(pushServerId, agent.id, agent.avatarUrl);
          continue;
        }
        for (const mood of LIVE_ACTIVITY_MOODS) {
          if (avatars.current.has(liveActivityBloubFile(agent.avatarSeed, agent.avatarHue, mood))) continue;
          bloubFile(agent, mood);
          drawn += 1;
          if (drawn % BLOUBS_PER_PAUSE === 0) await new Promise((resolve) => setTimeout(resolve, 0));
          if (cancelled) return;
        }
      }
      keepAvatars();
      const registration: LiveActivityPushRegistration = {
        serverId: pushServerId,
        token: pushToken,
        environment: pushEnvironment(),
        secret: secret.value,
        locale: currentLocale(),
        away: !foreground,
        photos: serverAgents.flatMap((agent) => {
          const file = agent.avatarUrl ? photos[photoName(pushServerId, agent.id, agent.avatarUrl)] : undefined;
          return file ? [{ agentId: agent.id, file }] : [];
        }),
      };
      const key = JSON.stringify(registration);
      if (cancelled || disposed.current || registered.current?.key === key) return;
      await post(pushServerId, LIVE_ACTIVITY_PUSH_ROUTES.register, { ...registration });
      if (!disposed.current) registered.current = { serverId: pushServerId, key };
    })().catch(() => {
      // The activity then shows its last state until the app returns, and marks it out of date.
      registered.current = null;
    });
    return () => {
      cancelled = true;
    };
  }, [live, pushServerId, pushServerOnline, pushToken, secret, foreground, photos, post, bloubFile, keepAvatars]);

  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      // Sign-out removes the workspace. The activity must not keep its agents, messages, and actions,
      // and the host of that workspace must not update the next one.
      resetLiveActivityActions();
      const previous = registered.current;
      registered.current = null;
      if (previous) {
        void postRef.current(previous.serverId, LIVE_ACTIVITY_PUSH_ROUTES.remove, {}).catch(() => undefined);
      }
      void resetLiveActivitySecret().catch(() => undefined);
      if (!live) return;
      live.native.removeAvatars(new Set());
      void syncFor(live.native).show(null);
    };
  }, [live, syncFor]);

  return applyTeamEvent;
}

/** The view the widget shows when it cannot open a host update, such as after sign-out. */
function unreadableProps(t: MobileTranslate): AgentLiveActivityProps {
  return {
    mode: "working",
    label: t("mobile.liveActivity.stale.label"),
    symbol: "sparkles",
    tint: "#8E8E93",
    title: t("mobile.liveActivity.appName"),
    detail: t("mobile.liveActivity.stale.detail"),
    compact: "",
    compactTint: "#8E8E93",
    footer: "",
    detailLines: 2,
    detailMarkdown: false,
    rows: [],
    avatar: "",
    tapUrl: LIVE_ACTIVITY_LIST_URL,
    buttons: [],
    agents: [],
    agentCount: 0,
    listUrl: LIVE_ACTIVITY_LIST_URL,
    moreLabel: "",
    appName: t("mobile.liveActivity.appName"),
    staleLabel: t("mobile.liveActivity.stale.label"),
    staleDetail: t("mobile.liveActivity.stale.detail"),
  };
}

/** The Alert title and the fallback message for an action that the host did not accept. */
const ACTION_FAILURES: Record<LiveActivityAction["type"], readonly [MobileTextKey, MobileTextKey]> = {
  "open-agent": ["mobile.liveActivity.error.openChat", "mobile.liveActivity.error.openChatFallback"],
  "open-failure": ["mobile.liveActivity.error.clearFailure", "mobile.liveActivity.error.clearFailureFallback"],
  "answer-prompt": ["mobile.liveActivity.error.answer", "mobile.liveActivity.error.answerFallback"],
  "respond-approval": ["mobile.liveActivity.error.decision", "mobile.liveActivity.error.decisionFallback"],
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

/** Development builds get their push tokens from the APNs sandbox. */
function pushEnvironment(): LiveActivityPushRegistration["environment"] {
  return __DEV__ || process.env.EXPO_PUBLIC_APP_ENV === "development" ? "development" : "production";
}

/** The picture name of an agent photo. It changes with the photo version. */
function photoName(serverId: string, agentId: string, avatarUrl: string): string {
  return liveActivityFileName([serverId, agentId, avatarVersion(avatarUrl)]);
}

function avatarVersion(avatarUrl: string): string {
  try {
    return new URL(avatarUrl).searchParams.get("v") ?? "";
  } catch {
    // The host sends a URL. Without a version, the photo is not loaded again after a change.
    return "";
  }
}

function isAgentEvent(event: AgentEvent | TeamRealtimeEvent): event is AgentEvent {
  return (
    event.type !== "team-identity" &&
    event.type !== "team-presence" &&
    event.type !== "team-direct-message" &&
    event.type !== "team-direct-typing"
  );
}
