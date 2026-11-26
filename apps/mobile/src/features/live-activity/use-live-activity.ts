import { avatarHeadColor } from "@openbot/brand/bloub-avatar";
import type { AgentEvent, AvatarColor, DynamicIslandAgentIdentity, TeamRealtimeEvent } from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  LIVE_ACTIVITY_PUSH_ROUTES,
  type LiveActivityPushRegistration,
} from "@openbot/contracts/team-protocol/live-activity-push-v1";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import type { MobileTextKey, MobileTranslate } from "@openbot/i18n/mobile";
import { redactText } from "@openbot/logging";
import { DynamicIslandCoordinator } from "@openbot/team-client/dynamic-island-coordinator";
import {
  type AgentLiveActivityProps,
  fitLiveActivityProps,
  LIVE_ACTIVITY_LIST_URL,
  LIVE_ACTIVITY_MOODS,
  type LiveActivityAction,
  type LiveActivityMood,
  liveActivityBloubFile,
  liveActivityBloubName,
  liveActivityFileName,
  liveActivityIslandText,
  liveActivityView,
} from "@openbot/team-client/live-activity-props";
import { encodeLiveActivityBytes } from "@openbot/team-client/live-activity-seal";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { useLiveActivitiesPreference } from "@/features/settings/model/live-activities";
import {
  effectiveServerNotificationSetting,
  useSyncedNotificationLevels,
} from "@/features/settings/model/notification-levels";
import {
  mutedUntil,
  showsInLiveActivity,
  usePushNotificationPreference,
} from "@/features/settings/model/push-notifications";
import type { LiveWorkspaceStore } from "@/features/workspace/model/live-workspace-store";
import type { MobileAgent, MobileServer } from "@/features/workspace/model/workspace-types";
import { usePushEnvironment } from "@/shared/lib/push-environment";
import { currentLocale, currentText } from "@/shared/lib/text";
import { agentLiveActivity } from "./agent-live-activity";
import type { AgentLiveActivityNative } from "./agent-live-activity.types";
import {
  emptyLiveActivityDismissals,
  type LiveActivityDismissals,
  type LiveActivityFailure,
  loadLiveActivityDismissals,
  sameLiveActivityFailure,
  saveLiveActivityDismissals,
} from "./model/live-activity-dismissals";
import { useLiveActivityHost } from "./model/live-activity-host";
import { liveActivityHostKeys, loadLiveActivitySecret, resetLiveActivitySecret } from "./model/live-activity-keys";
import {
  type LiveActivityRequest,
  onLiveActivityAction,
  resetLiveActivityActions,
  setLiveActivityLinkKeys,
} from "./model/live-activity-link";
import { LiveActivitySync, RESTART_AFTER_MS } from "./model/live-activity-sync";

const STALE_AFTER_BACKGROUND_MS = 5 * 60 * 1000;
const PUBLISH_DELAY_MS = 1000;
const BACKGROUND_PUBLISH_INTERVAL_MS = 1000;
const BLOUBS_PER_PAUSE = 4;
const AWAY_COLOR_MOOD: LiveActivityMood = "idle";
const MAX_TIMER_MS = 2_147_483_647;

type BloubAgent = Pick<DynamicIslandAgentIdentity, "avatarSeed" | "avatarHue" | "avatarColor">;

interface LiveActivityInput {
  servers: readonly Pick<MobileServer, "id" | "state">[];
  activeServerId: string | null;
  agents: readonly MobileAgent[];
  liveState: LiveWorkspaceStore;
  foreground: boolean;
  post: (serverId: string, path: string, body: TeamProtocolV2Json) => Promise<void>;
  loadAgentAvatar: (agentId: string, avatarUrl: string, serverId: string) => Promise<string>;
  supportsPush: (serverId: string) => boolean;
  sideThreadOfTurn: (serverId: string, agentId: string, turnId: string) => string | null;
}

export function useLiveActivity({
  servers,
  activeServerId,
  agents,
  liveState,
  foreground,
  post,
  loadAgentAvatar,
  supportsPush,
  sideThreadOfTurn,
}: LiveActivityInput): (serverId: string, event: AgentEvent | TeamRealtimeEvent) => void {
  const live = useMemo(() => {
    const native = agentLiveActivity();
    return native
      ? { native, coordinator: new DynamicIslandCoordinator(() => liveActivityIslandText(currentText().t)) }
      : null;
  }, []);
  const sync = useRef<LiveActivitySync<AgentLiveActivityProps> | null>(null);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const environment = usePushEnvironment();
  const [activityStartedAt, setActivityStartedAt] = useState<number | null>(null);
  const [secret, setSecret] = useState<Uint8Array | null>(null);
  const secretRef = useRef(secret);
  secretRef.current = secret;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const received = useRef(false);
  const serverIds = useMemo(() => servers.map((server) => server.id), [servers]);
  const serverOrder = useRef<string[]>([]);
  serverOrder.current = activeServerId
    ? [activeServerId, ...serverIds.filter((id) => id !== activeServerId)]
    : [...serverIds];
  const [hidden, setHidden] = useState<ReadonlySet<string> | null>(null);
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;
  const foregroundRef = useRef(foreground);
  foregroundRef.current = foreground;
  const pushServerRef = useRef<string | null>(null);
  const staleDate = useRef<Date | undefined>(undefined);
  const lastPublish = useRef<{ mode: string | null; at: number }>({ mode: null, at: 0 });
  const [resumed, setResumed] = useState(foreground);
  useEffect(() => setResumed(foreground), [foreground]);
  const avatars = useRef(new Map<string, string | null>());
  const [photos, setPhotos] = useState<Readonly<Record<string, string>>>({});
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  const loadAvatarRef = useRef(loadAgentAvatar);
  loadAvatarRef.current = loadAgentAvatar;
  const loadPhotoRef = useRef<(serverId: string, agentId: string, avatarUrl: string) => void>(() => undefined);
  const postRef = useRef(post);
  postRef.current = post;
  const sideThreadOfTurnRef = useRef(sideThreadOfTurn);
  sideThreadOfTurnRef.current = sideThreadOfTurn;
  const [request, setRequest] = useState<LiveActivityRequest | null>(null);
  const disposed = useRef(false);
  const registered = useRef<{ serverId: string; key: string } | null>(null);
  const registrationQueue = useRef<Promise<void>>(Promise.resolve());
  const enqueueRegistration = useCallback((run: () => Promise<void>) => {
    registrationQueue.current = registrationQueue.current.then(run).catch(() => undefined);
    return registrationQueue.current;
  }, []);

  const dismissals = useRef<LiveActivityDismissals | null>(null);
  const shownFailures = useRef(new WeakMap<AgentLiveActivityProps, LiveActivityFailure>());
  const savedDismissals = useCallback(() => {
    dismissals.current ??= loadLiveActivityDismissals();
    return dismissals.current;
  }, []);
  const [unacknowledged, setUnacknowledged] = useState<readonly LiveActivityFailure[]>(() =>
    live ? savedDismissals().dismissed : [],
  );
  const updateDismissals = useCallback((next: LiveActivityDismissals) => {
    dismissals.current = next;
    saveLiveActivityDismissals(next);
    setUnacknowledged(next.dismissed);
  }, []);
  const hideDismissedFailures = useCallback(() => {
    if (!live) return;
    for (const failure of savedDismissals().dismissed) {
      live.coordinator.resolveAction({ type: "dismiss-failure", ...failure });
    }
  }, [live, savedDismissals]);

  const syncFor = useCallback(
    (native: AgentLiveActivityNative) => {
      sync.current ??= new LiveActivitySync(native.starter, {
        pushToken: (token, startedAt) => {
          if (disposed.current) return;
          setPushToken(token);
          setActivityStartedAt(startedAt);
        },
        change: (action) => mobileAnalytics.track("live_activity_action", { action }),
        shown: (props, startedAt) => {
          if (disposed.current) return;
          const failure = props ? shownFailures.current.get(props) : undefined;
          const pushServer = pushServerRef.current;
          const otherServerPushes = !foregroundRef.current && pushServer !== null && pushServer !== failure?.serverId;
          const shown = failure && startedAt !== null && !otherServerPushes ? { failure, startedAt } : null;
          const saved = savedDismissals();
          if (JSON.stringify(shown) === JSON.stringify(saved.shown)) return;
          updateDismissals({ ...saved, shown });
        },
        dismissed: (startedAt) => {
          if (disposed.current) return;
          const saved = savedDismissals();
          const shown = saved.shown;
          const swiped =
            shown !== null &&
            (startedAt === null || startedAt === shown.startedAt) &&
            Date.now() - shown.startedAt < RESTART_AFTER_MS;
          if (swiped) {
            const known = saved.dismissed.some((failure) => sameLiveActivityFailure(failure, shown.failure));
            updateDismissals({ shown: null, dismissed: known ? saved.dismissed : [...saved.dismissed, shown.failure] });
            hideDismissedFailures();
          }
          void Promise.resolve().then(() => publishRef.current());
        },
      });
      return sync.current;
    },
    [savedDismissals, updateDismissals, hideDismissedFailures],
  );

  const keptAvatars = useRef(0);
  const keepAvatars = useCallback(() => {
    keptAvatars.current = avatars.current.size;
    live?.native.removeAvatars(new Set([...avatars.current.values()].filter((file) => file !== null)));
  }, [live]);

  const publishRef = useRef<() => void>(() => undefined);
  const drawBloub = useCallback(
    async (agent: BloubAgent, mood: LiveActivityMood) => {
      if (!live) return;
      const color = agent.avatarColor ?? null;
      const file = liveActivityBloubFile(agent.avatarSeed, agent.avatarHue, mood, color);
      if (avatars.current.has(file)) return;
      if (live.native.hasAvatar(file)) {
        avatars.current.set(file, file);
        return;
      }
      avatars.current.set(file, null);
      let written: string | null = null;
      try {
        const dataUrl = await live.native.renderBloub(agent.avatarSeed, agent.avatarHue, mood, color);
        if (disposed.current) return;
        const base = liveActivityBloubName(agent.avatarSeed, agent.avatarHue, mood, color);
        written = live.native.saveAvatar(base, dataUrl);
      } catch {}
      avatars.current.set(file, written);
      if (written) publishRef.current();
    },
    [live],
  );

  const bloubFile = useCallback(
    (agent: BloubAgent, mood: LiveActivityMood): string => {
      const file = liveActivityBloubFile(agent.avatarSeed, agent.avatarHue, mood, agent.avatarColor ?? null);
      const saved = avatars.current.get(file);
      if (saved !== undefined) return saved ?? "";
      void drawBloub(agent, mood);
      return avatars.current.get(file) ?? "";
    },
    [drawBloub],
  );

  const drawAwayFace = useCallback(
    (agent: BloubAgent) => {
      const file = awayFaceFile(agent);
      if (!file) return;
      void drawBloub(agent, AWAY_COLOR_MOOD).then(() => {
        const written = avatars.current.get(file);
        if (written) setPhotos((current) => (current[file] === written ? current : { ...current, [file]: written }));
      });
    },
    [drawBloub],
  );

  const publish = useCallback(
    (force = false) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (!live || !received.current || disposed.current) return;
      const preference = useLiveActivitiesPreference.getState();
      if (!preference.ready) return;
      if (!preference.enabled) {
        void syncFor(live.native).show(null);
        return;
      }
      const hiddenServers = hiddenRef.current;
      if (!hiddenServers) return;
      const phoneSecret = secretRef.current;
      if (!phoneSecret) return;
      const shownOrder = serverOrder.current.filter((serverId) => !hiddenServers.has(serverId));
      const presentation = live.coordinator.presentation(shownOrder);
      const { unreadAgentIds, unreadCounts } = liveState.get();
      const unread = new Set(unreadAgentIds);
      const servers = new Set(shownOrder);
      const props = liveActivityView(presentation, {
        t: currentText().t,
        agentColor: (agent) =>
          avatarHeadColor(agent.avatarSeed, agent.avatarHue, agentAvatarColor(presentation.serverId, agent)),
        avatar,
        unreadAgents: agentsRef.current
          .filter(
            (agent) =>
              unread.has(agent.id) &&
              servers.has(agent.serverId) &&
              !live.coordinator.mutedAgentIds(agent.serverId).has(agent.id),
          )
          .map((agent) => ({
            id: agent.id,
            serverId: agent.serverId,
            name: agent.name,
            avatarSeed: agent.avatarSeed,
            avatarHue: agent.avatarHue,
            avatarUrl: agent.avatarUrl ?? null,
            count: Math.max(1, unreadCounts[agent.id] ?? 1),
          })),
        actionKey: liveActivityHostKeys(phoneSecret, presentation.serverId).keys.action,
        threadId: live.coordinator.requestThreadId(presentation) ?? workingThread(),
        redact: redactText,
      });
      if (avatars.current.size !== keptAvatars.current) keepAvatars();
      const mode = props?.mode ?? null;
      const wait = lastPublish.current.at + BACKGROUND_PUBLISH_INTERVAL_MS - Date.now();
      if (!force && !foregroundRef.current && mode === lastPublish.current.mode && wait > 0) {
        timer.current = setTimeout(() => publish(), wait);
        return;
      }
      lastPublish.current = { mode, at: Date.now() };
      const fitted = props && fitLiveActivityProps(props);
      if (fitted && presentation.mode === "failed") {
        shownFailures.current.set(fitted, {
          serverId: presentation.serverId,
          agentId: presentation.item.agent.id,
          turnId: presentation.item.turnId,
        });
      }
      void syncFor(live.native).show(fitted, foregroundRef.current ? undefined : staleDate.current);

      function workingThread(): string | null {
        const working = live?.coordinator.workingTurn(presentation);
        return working ? sideThreadOfTurnRef.current(presentation.serverId, working.agentId, working.turnId) : null;
      }

      function agentAvatarColor(serverId: string, shown: DynamicIslandAgentIdentity): AvatarColor | null {
        const known = agentsRef.current.find((agent) => agent.serverId === serverId && agent.id === shown.id);
        return known?.avatarColor ?? shown.avatarColor ?? null;
      }

      function avatar(serverId: string, agent: DynamicIslandAgentIdentity, mood: LiveActivityMood): string {
        if (!live) return "";
        const colored = { ...agent, avatarColor: agentAvatarColor(serverId, agent) };
        if (!agent.avatarUrl) {
          drawAwayFace(colored);
          return bloubFile(colored, mood);
        }
        const name = photoName(serverId, agent.id, agent.avatarUrl);
        const saved = avatars.current.get(name);
        if (saved) return saved;
        if (saved === undefined) loadPhotoRef.current(serverId, agent.id, agent.avatarUrl);
        return bloubFile(colored, mood);
      }
    },
    [live, liveState, syncFor, bloubFile, drawAwayFace, keepAvatars],
  );
  publishRef.current = () => {
    if (!foregroundRef.current) publish();
    else timer.current ??= setTimeout(publish, PUBLISH_DELAY_MS);
  };

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
        .catch(() => undefined);
    },
    [live, keepAvatars, publish],
  );
  loadPhotoRef.current = loadPhoto;

  const schedule = useCallback(() => {
    if (!foregroundRef.current) publish();
    else timer.current ??= setTimeout(publish, PUBLISH_DELAY_MS);
  }, [publish]);

  const applyTeamEvent = useCallback(
    (serverId: string, event: AgentEvent | TeamRealtimeEvent) => {
      if (!live || !isAgentEvent(event)) return;
      received.current = true;
      live.coordinator.applyEvent({ serverId, event }, serverId);
      hideDismissedFailures();
      schedule();
    },
    [live, schedule, hideDismissedFailures],
  );

  const acknowledging = useRef(new Set<string>());
  useEffect(() => {
    if (!live || !foreground) return;
    for (const failure of unacknowledged) {
      const key = JSON.stringify([failure.serverId, failure.agentId, failure.turnId]);
      const server = servers.find((candidate) => candidate.id === failure.serverId);
      if (server?.state !== "online" || acknowledging.current.has(key)) continue;
      acknowledging.current.add(key);
      void post(failure.serverId, TEAM_API_ROUTES.agent.failuresAcknowledge(failure.agentId), {
        turnId: failure.turnId,
      })
        .then(
          () => {
            if (disposed.current) return;
            const saved = savedDismissals();
            const dismissed = saved.dismissed.filter((other) => !sameLiveActivityFailure(other, failure));
            updateDismissals({ ...saved, dismissed });
          },
          () => undefined,
        )
        .finally(() => acknowledging.current.delete(key));
    }
  }, [live, foreground, unacknowledged, servers, post, savedDismissals, updateDismissals]);

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    void loadLiveActivitySecret().then(
      (phoneSecret) => {
        if (cancelled || disposed.current) return;
        setSecret(phoneSecret);
        setLiveActivityLinkKeys((serverId) => liveActivityHostKeys(phoneSecret, serverId).keys.action);
      },
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
    if (!live || !secret) return;
    const { t } = currentText();
    const keys = activeServerId ? liveActivityHostKeys(secret, activeServerId).keys : null;
    live.native.setSealKeys(
      keys && { seal: encodeLiveActivityBytes(keys.seal), tag: encodeLiveActivityBytes(keys.tag) },
      unreadableProps(t),
    );
  }, [live, secret, activeServerId]);

  useEffect(() => {
    if (!live) return;
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

  useEffect(() => {
    if (!live || !request || !foreground || !resumed) return;
    const { action, command } = request;
    const server = servers.find((candidate) => candidate.id === action.serverId);
    if (server && server.state !== "online") return;
    setRequest(null);
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
          showFailureAlert(error, "other", t(title), errorMessage(error, t(fallback)));
        },
      );
    if (action.type !== "respond-approval" || action.decision !== "accept") {
      perform();
      return;
    }
    const { t } = currentText();
    if (!command) {
      showFailureAlert(
        undefined,
        "other",
        t("mobile.liveActivity.error.decision"),
        t("mobile.liveActivity.requestChanged"),
      );
      return;
    }
    Alert.alert(t("mobile.liveActivity.confirm.title"), command, [
      { text: t("mobile.liveActivity.confirm.cancel"), style: "cancel" },
      { text: t("mobile.liveActivity.confirm.approve"), onPress: perform },
    ]);
  }, [live, request, servers, post, schedule, foreground, resumed]);

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

  useEffect(() => {
    let muteEnd: ReturnType<typeof setTimeout> | null = null;
    const apply = () => {
      if (muteEnd) clearTimeout(muteEnd);
      muteEnd = null;
      const preference = usePushNotificationPreference.getState();
      const synced = useSyncedNotificationLevels.getState().servers;
      let next: ReadonlySet<string> | null = null;
      if (preference.ready) {
        const now = Date.now();
        const settings = serverIds.map(
          (serverId) => [serverId, effectiveServerNotificationSetting(preference, synced[serverId], serverId)] as const,
        );
        next = new Set(
          settings.filter(([, setting]) => !showsInLiveActivity(setting, now)).map(([serverId]) => serverId),
        );
        const ends = settings.flatMap(([, setting]) => {
          const until = mutedUntil(setting, now);
          return until !== null && Number.isFinite(until) ? [until] : [];
        });
        if (ends.length > 0) muteEnd = setTimeout(apply, Math.min(Math.min(...ends) - now, MAX_TIMER_MS));
      }
      const current = hiddenRef.current;
      if (next === current || (next && current && sameServers(next, current))) return;
      hiddenRef.current = next;
      setHidden(next);
      publish();
    };
    apply();
    const unsubscribe = usePushNotificationPreference.subscribe((state, previous) => {
      if (state.ready !== previous.ready || state.servers !== previous.servers) apply();
    });
    const unsubscribeSynced = useSyncedNotificationLevels.subscribe((state, previous) => {
      if (state.servers !== previous.servers) apply();
    });
    return () => {
      unsubscribe();
      unsubscribeSynced();
      if (muteEnd) clearTimeout(muteEnd);
    };
  }, [serverIds, publish]);

  useEffect(() => {
    staleDate.current = foreground ? undefined : new Date(Date.now() + STALE_AFTER_BACKGROUND_MS);
    if (foreground) sync.current?.forget();
    publish(!foreground);
  }, [foreground, publish]);

  const pushServerId =
    live &&
    enabled &&
    pushToken &&
    secret &&
    activeServerId &&
    hidden &&
    !hidden.has(activeServerId) &&
    supportsPush(activeServerId)
      ? activeServerId
      : null;
  pushServerRef.current = pushServerId;
  useEffect(() => {
    if (!live || foreground || !pushServerId) return;
    const saved = savedDismissals();
    if (saved.shown && saved.shown.failure.serverId !== pushServerId) updateDismissals({ ...saved, shown: null });
  }, [live, foreground, pushServerId, savedDismissals, updateDismissals]);
  useEffect(() => {
    useLiveActivityHost.setState({ serverId: pushServerId, startedAt: pushServerId ? activityStartedAt : null });
    return () => useLiveActivityHost.setState({ serverId: null, startedAt: null });
  }, [pushServerId, activityStartedAt]);
  const pushServerOnline = servers.some((server) => server.id === pushServerId && server.state === "online");
  useEffect(() => {
    if (!live) return;
    const previous = registered.current;
    if (previous && previous.serverId !== pushServerId) {
      registered.current = null;
      void enqueueRegistration(() => post(previous.serverId, LIVE_ACTIVITY_PUSH_ROUTES.remove, {}));
    }
    if (!pushServerOnline && registered.current) registered.current = { ...registered.current, key: "" };
    if (!pushServerId || !pushServerOnline || !pushToken || !secret || !environment) return;
    let cancelled = false;
    const serverAgents = agentsRef.current.filter((agent) => agent.serverId === pushServerId);
    void (async () => {
      let drawn = 0;
      for (const agent of serverAgents) {
        if (agent.avatarUrl) loadPhotoRef.current(pushServerId, agent.id, agent.avatarUrl);
        else drawAwayFace(agent);
        for (const mood of LIVE_ACTIVITY_MOODS) {
          if (avatars.current.has(liveActivityBloubFile(agent.avatarSeed, agent.avatarHue, mood))) continue;
          await drawBloub({ avatarSeed: agent.avatarSeed, avatarHue: agent.avatarHue }, mood);
          drawn += 1;
          if (drawn % BLOUBS_PER_PAUSE === 0) await new Promise((resolve) => setTimeout(resolve, 0));
          if (cancelled) return;
        }
      }
      keepAvatars();
      const registration: LiveActivityPushRegistration = {
        serverId: pushServerId,
        token: pushToken,
        environment,
        secret: encodeLiveActivityBytes(liveActivityHostKeys(secret, pushServerId).secret),
        locale: currentLocale(),
        away: !foreground,
        photos: serverAgents.flatMap((agent) => {
          const awayFace = awayFaceFile(agent);
          const file = agent.avatarUrl
            ? photos[photoName(pushServerId, agent.id, agent.avatarUrl)]
            : awayFace
              ? photos[awayFace]
              : undefined;
          return file ? [{ agentId: agent.id, file }] : [];
        }),
      };
      const key = JSON.stringify(registration);
      await enqueueRegistration(async () => {
        if (cancelled || disposed.current || registered.current?.key === key) return;
        registered.current = { serverId: pushServerId, key: "" };
        try {
          await post(pushServerId, LIVE_ACTIVITY_PUSH_ROUTES.register, { ...registration });
        } catch {
          return;
        }
        if (!cancelled && registered.current?.serverId === pushServerId) {
          registered.current = { serverId: pushServerId, key };
        }
      });
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [
    live,
    pushServerId,
    pushServerOnline,
    pushToken,
    secret,
    environment,
    foreground,
    photos,
    post,
    drawBloub,
    drawAwayFace,
    keepAvatars,
    enqueueRegistration,
  ]);

  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      resetLiveActivityActions();
      const previous = registered.current;
      registered.current = null;
      if (previous) {
        void enqueueRegistration(() => postRef.current(previous.serverId, LIVE_ACTIVITY_PUSH_ROUTES.remove, {}));
      }
      void resetLiveActivitySecret().catch(() => undefined);
      if (!live) return;
      live.native.removeAvatars(new Set());
      avatars.current.clear();
      keptAvatars.current = 0;
      setPhotos({});
      void syncFor(live.native).show(null);
      updateDismissals(emptyLiveActivityDismissals());
    };
  }, [live, syncFor, enqueueRegistration, updateDismissals]);

  return applyTeamEvent;
}

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

function awayFaceFile(agent: BloubAgent): string | null {
  return agent.avatarColor
    ? liveActivityBloubFile(agent.avatarSeed, agent.avatarHue, AWAY_COLOR_MOOD, agent.avatarColor)
    : null;
}

function photoName(serverId: string, agentId: string, avatarUrl: string): string {
  return liveActivityFileName([serverId, agentId, avatarVersion(avatarUrl)]);
}

function avatarVersion(avatarUrl: string): string {
  try {
    return new URL(avatarUrl).searchParams.get("v") ?? "";
  } catch {
    return "";
  }
}

function sameServers(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((serverId) => right.has(serverId));
}

function isAgentEvent(event: AgentEvent | TeamRealtimeEvent): event is AgentEvent {
  return (
    event.type !== "team-identity" &&
    event.type !== "team-presence" &&
    event.type !== "team-direct-message" &&
    event.type !== "team-direct-typing"
  );
}
