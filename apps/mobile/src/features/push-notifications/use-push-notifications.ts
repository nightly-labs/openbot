import { PUSH_NOTIFICATION_THREADS_ROUTES } from "@openbot/contracts/team-protocol/push-notification-threads-v1";
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
import { supportLog, supportLogValue } from "@/features/support/model/support-log";
import type { MobileServer } from "@/features/workspace/model/workspace-types";
import { isAndroid } from "@/shared/lib/platform";
import { usePushEnvironment } from "@/shared/lib/push-environment";
import { currentLocale } from "@/shared/lib/text";
import { pushNotificationsNative as native } from "./push-notifications-native";

interface PushNotificationsInput {
  servers: readonly Pick<MobileServer, "id" | "name" | "state">[];
  serversReady: boolean;
  foreground: boolean;
  post(serverId: string, path: string, body: TeamProtocolV2Json): Promise<unknown>;
  supportsPush(serverId: string): boolean;
  supportsThreads(serverId: string): boolean;
}

const RETRY_MS = 30_000;

let lastPushLine = "";
function logPush(level: "info" | "warn", text: string): void {
  if (text === lastPushLine) return;
  lastPushLine = text;
  supportLog.add(level, "app", `Notifications: ${text}`);
}

const serverLines = new Map<string, string>();
function logServerPush(serverId: string, level: "info" | "warn", text: string): void {
  if (serverLines.get(serverId) === text) return;
  serverLines.set(serverId, text);
  supportLog.add(level, "connection", `${serverId} notifications ${text}`);
}
const ROUTES = isAndroid ? ANDROID_PUSH_NOTIFICATIONS_ROUTES : PUSH_NOTIFICATIONS_ROUTES;

export function usePushNotifications({
  servers,
  serversReady,
  foreground,
  post,
  supportsPush,
  supportsThreads,
}: PushNotificationsInput): void {
  const preference = usePushNotificationPreference();
  const synced = useSyncedNotificationLevels((state) => state.servers);
  const liveActivities = useLiveActivitiesPreference();
  const activityHost = useLiveActivityHost();
  const environment = usePushEnvironment();
  const [token, setToken] = useState<string | null>(null);
  const [secret, setSecret] = useState<Uint8Array | null>(null);
  const registered = useRef(new Map<string, { key: string; removed: boolean; threads: boolean | null }>());
  const postRef = useRef(post);
  postRef.current = post;
  const queues = useRef(new Map<string, Promise<void>>());
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

  useEffect(() => {
    const push = native;
    if (preference.ready && !preference.enabled) logPush("info", "off in the app settings");
    if (!push || !enabled || !foreground) return;
    let current = true;
    let again: ReturnType<typeof setTimeout> | null = null;
    const readToken = async () => {
      try {
        const device = await push.deviceToken();
        logPush(device ? "info" : "warn", device ? "push token received" : "the phone gave no push token");
        if (current) setToken(device);
      } catch (error) {
        logPush("warn", `push token not read: ${supportLogValue(error)}`);
        if (current) again = setTimeout(() => void readToken(), RETRY_MS);
      }
    };
    void (async () => {
      const permission = await push.permission((answer) =>
        mobileAnalytics.track("notification_settings_action", { action: "permission_prompted", permission: answer }),
      );
      logPush(permission === "denied" ? "warn" : "info", `permission ${permission}`);
      if (!current) return;
      setNotificationPermission(permission);
      if (permission === "granted") await readToken();
    })().catch(() => undefined);
    return () => {
      current = false;
      if (again) clearTimeout(again);
    };
  }, [enabled, foreground, preference.ready, preference.enabled]);

  useEffect(() => native?.onDeviceToken(setToken), []);

  useEffect(() => {
    if (!native || !secret || !serversReady) return;
    try {
      native.writeKeys(
        servers.map(({ id, name }) => {
          const keys = pushNotificationKeys(liveActivityHostKeys(secret, id).secret);
          return {
            serverId: id,
            name,
            seal: encodeLiveActivityBytes(keys.seal),
            tag: encodeLiveActivityBytes(keys.tag),
          };
        }),
      );
    } catch {}
  }, [secret, servers, serversReady]);

  useEffect(() => {
    if (!native || !preference.ready || !liveActivities.ready || !secret || !environment) return;
    if (preference.enabled && preference.permission === null) return;
    const deliverable = preference.enabled && preference.permission === "granted";
    if (deliverable && !token) return;
    const activitySound = !isAndroid && liveActivities.enabled && preference.playSound;
    const now = Date.now();
    for (const server of servers) {
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
      const key = `${attempt}:${JSON.stringify(registration)}`;
      const threads = registration && supportsThreads(server.id) ? preference.threadReplies : null;
      const last = registered.current.get(server.id);
      const sendRegistration = last?.key !== key;
      const replies = threads !== null && last?.threads !== threads ? threads : null;
      if (!sendRegistration && replies === null) continue;
      registered.current.set(server.id, { key, removed: registration === null, threads });
      const serverId = server.id;
      enqueue(serverId, async () => {
        try {
          if (sendRegistration) {
            await postRef.current(
              serverId,
              registration ? ROUTES.register : ROUTES.remove,
              registration ? { ...registration } : {},
            );
            logServerPush(
              serverId,
              "info",
              registration
                ? `registered, level ${registration.level}, ${registration.token ? "with" : "without"} a push token`
                : "removed",
            );
          }
          if (replies !== null) await postRef.current(serverId, PUSH_NOTIFICATION_THREADS_ROUTES.set, { replies });
        } catch (error) {
          logServerPush(serverId, "warn", `not registered: ${supportLogValue(error)}`);
          const current = registered.current.get(serverId);
          if (current?.key === key) registered.current.delete(serverId);
          else if (current && replies !== null) current.threads = null;
          else return;
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
    supportsThreads,
    enqueue,
    attempt,
  ]);

  useEffect(() => {
    const sent = registered.current;
    return () => {
      if (retry.current) clearTimeout(retry.current);
      retry.current = null;
      for (const [serverId, { removed }] of sent) {
        if (!removed) void postRef.current(serverId, ROUTES.remove, {}).catch(() => undefined);
      }
      sent.clear();
      try {
        native?.removeKeys();
      } catch {}
    };
  }, []);
}
