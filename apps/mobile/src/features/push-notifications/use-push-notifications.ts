import {
  ANDROID_PUSH_NOTIFICATIONS_ROUTES,
  type AndroidPushNotificationRegistration,
} from "@openbot/contracts/team-protocol/push-notifications-android-v1";
import {
  PUSH_NOTIFICATIONS_ROUTES,
  type PushNotificationRegistration,
} from "@openbot/contracts/team-protocol/push-notifications-v1";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { encodeLiveActivityBytes } from "@openbot/team-client/live-activity-seal";
import { pushNotificationKeys } from "@openbot/team-client/push-notification-seal";
import { useCallback, useEffect, useRef, useState } from "react";
import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { useLiveActivityHost } from "@/features/live-activity/model/live-activity-host";
import { liveActivityHostKeys, loadLiveActivitySecret } from "@/features/live-activity/model/live-activity-keys";
import { useLiveActivitiesPreference } from "@/features/settings/model/live-activities";
import {
  effectiveServerNotificationSetting,
  useSyncedNotificationLevels,
} from "@/features/settings/model/notification-levels";
import {
  loadPushNotificationPreference,
  mutedUntil,
  registeredSound,
  setNotificationPermission,
  usePushNotificationPreference,
} from "@/features/settings/model/push-notifications";
import type { MobileServer } from "@/features/workspace/model/workspace-types";
import { isAndroid } from "@/shared/lib/platform";
import { usePushEnvironment } from "@/shared/lib/push-environment";
import { currentLocale } from "@/shared/lib/text";
import { pushNotificationsNative as native } from "./push-notifications-native";

interface PushNotificationsInput {
  servers: readonly Pick<MobileServer, "id" | "name" | "state">[];
  /**
   * Whether `servers` came from the account service. Before that, and when it failed, the list is
   * empty, and the key file keeps the keys of the last list.
   */
  serversReady: boolean;
  /** While the app is on screen, the hosts send nothing: the app shows the event itself. */
  foreground: boolean;
  post(serverId: string, path: string, body: TeamProtocolV2Json): Promise<unknown>;
  supportsPush(serverId: string): boolean;
}

/** A request that failed is sent again after this time, or at the next change or connection. */
const RETRY_MS = 30_000;
/** An iPhone registers through `push-notifications-v1`, an Android phone through `push-notifications-android-v1`. */
const ROUTES = isAndroid ? ANDROID_PUSH_NOTIFICATIONS_ROUTES : PUSH_NOTIFICATIONS_ROUTES;

/**
 * Gives each connected server that supports the notifications of this platform the push token of the
 * app, the events that the user chose, and whether the app is on screen. The server level is the
 * level that the user chose for all of their devices, or this phone's level when they chose none. With notifications off, an
 * iPhone still registers without a token when the Live Activity plays the sound, because the host
 * decides when it does. A host keeps the registration also when it restarts, so the phone tells each
 * host again after each connection, and removes it when the user turns both off for that host or
 * signs out.
 */
export function usePushNotifications({
  servers,
  serversReady,
  foreground,
  post,
  supportsPush,
}: PushNotificationsInput): void {
  const preference = usePushNotificationPreference();
  // The level that the user chose for all of their devices replaces the level of this phone. The host
  // applies it too, and the levels of the agents, so a change registers again only when it turns the
  // server on or off here, or changes the level of the registration.
  const synced = useSyncedNotificationLevels((state) => state.servers);
  const liveActivities = useLiveActivitiesPreference();
  const activityHost = useLiveActivityHost();
  // An iPhone registers only when it knows which Apple environment its token is for.
  const environment = usePushEnvironment();
  const [token, setToken] = useState<string | null>(null);
  const [secret, setSecret] = useState<Uint8Array | null>(null);
  /** What the phone last told each host, so an unchanged state is not sent again. */
  const registered = useRef(new Map<string, { key: string; removed: boolean }>());
  const postRef = useRef(post);
  postRef.current = post;
  const queues = useRef(new Map<string, Promise<void>>());
  /**
   * A removal cannot reach a host before the registration that it removes. Each server has its own
   * queue, so a host that does not answer does not hold the others.
   */
  const enqueue = useCallback((serverId: string, run: () => Promise<void>) => {
    queues.current.set(
      serverId,
      (queues.current.get(serverId) ?? Promise.resolve()).then(run).catch(() => undefined),
    );
  }, []);
  const [attempt, setAttempt] = useState(0);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabled = preference.ready && preference.enabled;

  useEffect(() => {
    if (!native) return;
    let current = true;
    void loadLiveActivitySecret().then(
      (loaded) => {
        if (current) setSecret(loaded);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    if (native && foreground) void loadPushNotificationPreference().catch(() => undefined);
  }, [foreground]);

  // The phone asks once. The answer can change in the phone settings while the app is away, so it is read again.
  // Apple or Google can fail to give the token, as without network at the first launch. Without it no
  // host gets the phone, so the read runs again while the app is on screen.
  useEffect(() => {
    // A local name, so that the check above also holds in the function below.
    const push = native;
    if (!push || !enabled || !foreground) return;
    let current = true;
    let again: ReturnType<typeof setTimeout> | null = null;
    const readToken = async () => {
      try {
        const device = await push.deviceToken();
        if (current) setToken(device);
      } catch {
        if (current) again = setTimeout(() => void readToken(), RETRY_MS);
      }
    };
    void (async () => {
      const permission = await push.permission((answer) =>
        mobileAnalytics.track("notification_settings_action", { action: "permission_prompted", permission: answer }),
      );
      if (!current) return;
      setNotificationPermission(permission);
      if (permission === "granted") await readToken();
    })().catch(() => undefined);
    return () => {
      current = false;
      if (again) clearTimeout(again);
    };
  }, [enabled, foreground]);

  useEffect(() => native?.onDeviceToken(setToken), []);

  // The file is written again only when a server or its name changes. A list that did not load would
  // remove the keys, and each notification would then show the app name only.
  useEffect(() => {
    if (!native || !secret || !serversReady) return;
    try {
      native.writeKeys(
        servers.map(({ id, name }) => {
          const keys = pushNotificationKeys(liveActivityHostKeys(secret, id).secret);
          // `NotificationService.swift` and `SealedNotification.kt` read these field names.
          return {
            serverId: id,
            name,
            seal: encodeLiveActivityBytes(keys.seal),
            tag: encodeLiveActivityBytes(keys.tag),
          };
        }),
      );
    } catch {
      // Without the file the extension shows the app name only.
    }
  }, [secret, servers, serversReady]);

  useEffect(() => {
    if (!native || !preference.ready || !liveActivities.ready || !secret || !environment) return;
    // Wait for iOS and the token, so a phone that has notifications does not remove them at launch.
    if (preference.enabled && preference.permission === null) return;
    const deliverable = preference.enabled && preference.permission === "granted";
    if (deliverable && !token) return;
    // With notifications off, the Live Activity of an iPhone can still play the sound, which the host
    // starts. Android has no Live Activity.
    const activitySound = !isAndroid && liveActivities.enabled && preference.playSound;
    const now = Date.now();
    for (const server of servers) {
      // A host forgets nothing when the phone goes offline, but the phone tells it again on reconnect.
      if (server.state !== "online") {
        registered.current.delete(server.id);
        continue;
      }
      if (!supportsPush(server.id)) continue;
      const setting = effectiveServerNotificationSetting(preference, synced[server.id], server.id);
      const muted = mutedUntil(setting, now);
      let registration: PushNotificationRegistration | AndroidPushNotificationRegistration | null = null;
      if ((deliverable || activitySound) && setting.level !== "nothing" && muted !== Number.POSITIVE_INFINITY) {
        const common = {
          serverId: server.id,
          secret: encodeLiveActivityBytes(liveActivityHostKeys(secret, server.id).secret),
          locale: currentLocale(),
          away: !foreground,
          level: setting.level,
          mutedUntil: muted === null ? null : Math.ceil(muted / 1_000),
          preview: preference.preview,
          sound: registeredSound(preference),
        };
        if (isAndroid) registration = token ? { ...common, token } : null;
        else {
          registration = {
            ...common,
            token: deliverable ? token : null,
            environment,
            liveActivityStartedAt:
              activityHost.serverId === server.id && activityHost.startedAt !== null
                ? Math.floor(activityHost.startedAt / 1_000)
                : null,
          };
        }
      }
      // A retry after a failed request sends the state again.
      const key = `${attempt}:${JSON.stringify(registration)}`;
      if (registered.current.get(server.id)?.key === key) continue;
      registered.current.set(server.id, { key, removed: registration === null });
      const serverId = server.id;
      enqueue(serverId, async () => {
        try {
          await postRef.current(
            serverId,
            registration ? ROUTES.register : ROUTES.remove,
            registration ? { ...registration } : {},
          );
        } catch {
          if (registered.current.get(serverId)?.key !== key) return;
          registered.current.delete(serverId);
          retry.current ??= setTimeout(() => {
            retry.current = null;
            setAttempt((count) => count + 1);
          }, RETRY_MS);
        }
      });
    }
  }, [
    servers,
    foreground,
    token,
    secret,
    environment,
    preference,
    synced,
    liveActivities,
    activityHost,
    supportsPush,
    enqueue,
    attempt,
  ]);

  useEffect(() => {
    const sent = registered.current;
    return () => {
      if (retry.current) clearTimeout(retry.current);
      retry.current = null;
      // Sign-out removes the workspace. Its hosts must not notify about it, and the extension must not
      // open a notification of it. The requests go at once: the server connections close after this
      // cleanup. A host that does not get one learns it from the account service, which refuses the
      // ended session.
      for (const [serverId, { removed }] of sent) {
        if (!removed) void postRef.current(serverId, ROUTES.remove, {}).catch(() => undefined);
      }
      sent.clear();
      try {
        native?.removeKeys();
      } catch {
        // The keys open nothing after sign-out: the phone secret changes.
      }
    };
  }, []);
}
