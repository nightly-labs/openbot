import type { ServerNotificationLevel } from "@openbot/contracts/ipc";
import { NOTIFICATION_SOUNDS, type NotificationSound } from "@openbot/contracts/notification-relay";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import type { PushNotificationSound } from "@openbot/contracts/team-protocol/push-notifications-v1";
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

const key = "openbot.mobile.push-notifications.v1";

/** What one server may notify about, as the desktop app sets it for each server. */
export interface ServerNotificationSetting {
  level: ServerNotificationLevel;
  /** `null` when not muted. A mute with `until: null` lasts until the user turns it off. */
  mute: { until: number | null } | null;
}

const DEFAULT_SERVER_NOTIFICATIONS: ServerNotificationSetting = { level: "all", mute: null };

interface StoredPreference {
  enabled: boolean;
  preview: boolean;
  /** Whether notifications and the Live Activity play `sound`. Off keeps the choice for later. */
  playSound: boolean;
  sound: NotificationSound;
  servers: Record<string, ServerNotificationSetting>;
}

/**
 * The notification permission of the phone, read when the app starts and each time it comes back.
 * `null` until it is read.
 */
export type NotificationPermission = "granted" | "denied" | "undetermined";

export const usePushNotificationPreference = create<
  StoredPreference & { ready: boolean; saving: boolean; permission: NotificationPermission | null }
>(() => ({
  enabled: true,
  preview: true,
  playSound: true,
  sound: "openbot",
  servers: {},
  ready: false,
  saving: false,
  permission: null,
}));

/**
 * A failed read leaves the preference not ready, and nothing registers. With the defaults, a host
 * could show reply text that the user turned off. The app reads it again when it comes back.
 */
export async function loadPushNotificationPreference(): Promise<void> {
  if (usePushNotificationPreference.getState().ready) return;
  const stored = decode(await SecureStore.getItemAsync(key));
  // A second startup read must not overwrite a change made in Settings.
  if (usePushNotificationPreference.getState().ready) return;
  usePushNotificationPreference.setState({ ...stored, ready: true });
}

/** Applies the change at once, also when storage fails. Settings then offers to save it again. */
export async function savePushNotificationPreference(
  change: Partial<Omit<StoredPreference, "servers">>,
): Promise<void> {
  await save((stored) => ({ ...stored, ...change }));
}

export async function saveServerNotificationSetting(
  serverId: string,
  change: Partial<ServerNotificationSetting>,
): Promise<void> {
  await save((stored) => ({
    ...stored,
    servers: { ...stored.servers, [serverId]: { ...serverNotificationSetting(stored, serverId), ...change } },
  }));
}

export function serverNotificationSetting(
  preference: Pick<StoredPreference, "servers">,
  serverId: string,
): ServerNotificationSetting {
  return preference.servers[serverId] ?? DEFAULT_SERVER_NOTIFICATIONS;
}

/** The end of a timed mute in milliseconds, `Infinity` for a mute without one, or `null` when not muted. */
export function mutedUntil(setting: ServerNotificationSetting, now: number): number | null {
  if (!setting.mute) return null;
  if (setting.mute.until === null) return Number.POSITIVE_INFINITY;
  return setting.mute.until > now ? setting.mute.until : null;
}

/**
 * Whether the Live Activity can show a server. It follows the notification choices of the server:
 * "Nothing" or a mute hides the server, and only that server.
 */
export function showsInLiveActivity(setting: ServerNotificationSetting, now: number): boolean {
  return setting.level !== "nothing" && mutedUntil(setting, now) === null;
}

/** The sound that the hosts play for notifications and the Live Activity. */
export function registeredSound(preference: Pick<StoredPreference, "playSound" | "sound">): PushNotificationSound {
  return preference.playSound ? preference.sound : "none";
}

export function setNotificationPermission(permission: NotificationPermission): void {
  usePushNotificationPreference.setState({ permission });
}

async function save(change: (stored: StoredPreference) => StoredPreference): Promise<void> {
  const state = usePushNotificationPreference.getState();
  if (!state.ready || state.saving) return;
  const next = change(state);
  usePushNotificationPreference.setState({ ...next, saving: true });
  try {
    const { enabled, preview, playSound, sound, servers } = next;
    await SecureStore.setItemAsync(key, JSON.stringify({ enabled, preview, playSound, sound, servers }));
  } finally {
    usePushNotificationPreference.setState({ saving: false });
  }
}

function decode(value: string | null): StoredPreference | null {
  if (!value) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!isDynamicRecord(parsed)) return null;
  const sound = parsed.sound;
  const servers: Record<string, ServerNotificationSetting> = {};
  if (isDynamicRecord(parsed.servers)) {
    for (const [serverId, setting] of Object.entries(parsed.servers)) {
      if (!isDynamicRecord(setting)) continue;
      const level = setting.level;
      if (level !== "all" && level !== "needs-me" && level !== "nothing") continue;
      const mute = isDynamicRecord(setting.mute)
        ? { until: typeof setting.mute.until === "number" ? setting.mute.until : null }
        : null;
      servers[serverId] = { level, mute };
    }
  }
  return {
    enabled: parsed.enabled !== false,
    preview: parsed.preview !== false,
    // An earlier build saved "none" as a sound.
    playSound: sound !== "none" && parsed.playSound !== false,
    sound: NOTIFICATION_SOUNDS.find((known) => known === sound) ?? "openbot",
    servers,
  };
}
