import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import {
  ANDROID_PUSH_NOTIFICATIONS_CODECS,
  ANDROID_PUSH_NOTIFICATIONS_ROUTES,
  type AndroidPushNotificationRegistration,
} from "@openbot/contracts/team-protocol/push-notifications-android-v1";
import {
  PUSH_NOTIFICATION_SOUNDS,
  PUSH_NOTIFICATIONS_CODECS,
  PUSH_NOTIFICATIONS_ROUTES,
  type PushNotificationRegistration,
} from "@openbot/contracts/team-protocol/push-notifications-v1";
import { Effect, Result, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

/**
 * What a phone registered: an iPhone through `push-notifications-v1`, or an Android phone through
 * `push-notifications-android-v1`. An iPhone entry has no `platform`, as in the files of earlier hosts.
 */
export type PushTarget =
  | { platform?: undefined; value: PushNotificationRegistration }
  | { platform: "android"; value: AndroidPushNotificationRegistration };

/** One phone that gets notifications, with what the host needs to know what its member can see. */
export type StoredPushRegistration = {
  sessionId: string;
  memberId: string;
  /** The Team API protocol and capabilities of the phone, which decide the agents it can see. */
  protocol: number;
  capabilities: string[];
  /**
   * Whether the phone takes the notifications of side thread turns, as it said through
   * `push-notification-threads-v1`. Absent for a phone that never said: it takes them. An earlier host
   * does not read this field.
   */
  threadReplies?: boolean;
} & PushTarget;

/** More phones than members can have sessions is a fault. The oldest go first. */
const REGISTRATION_LIMIT = 500;
const decodeRegistration = PUSH_NOTIFICATIONS_CODECS.get(PUSH_NOTIFICATIONS_ROUTES.register)?.request;
const decodeAndroidRegistration = ANDROID_PUSH_NOTIFICATIONS_CODECS.get(
  ANDROID_PUSH_NOTIFICATIONS_ROUTES.register,
)?.request;

/**
 * The phones of this host that get notifications. A phone registers when it connects, but a phone in
 * a pocket does not connect after this computer restarts, so the host keeps the list in a file that
 * only the user can read. Each entry has the push token and the sealing secret of one phone, an
 * iPhone or an Android phone.
 *
 * Writes are chained, as `NotificationPreferenceStore` chains its own.
 */
export class PushNotificationStore {
  readonly #path: string;
  #registrations: StoredPushRegistration[] = [];
  #writes = Semaphore.makeUnsafe(1);

  constructor(path: string) {
    this.#path = path;
  }

  load(): Effect.Effect<void, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const loaded = yield* Effect.result(readPreferenceFile(this.#path, decodeFile));
      if (Result.isSuccess(loaded)) this.#registrations = loaded.success;
      else if (!isMissingFileError(loaded.failure.cause) && !(loaded.failure.cause instanceof SyntaxError))
        return yield* loaded.failure;
    });
  }

  list(): readonly StoredPushRegistration[] {
    return this.#registrations;
  }

  /** Replaces the list. The phone's `away` changes all the time and is not kept: a restart starts away. */
  replace(registrations: readonly StoredPushRegistration[]): Effect.Effect<void, PreferenceFileFailure> {
    const next = registrations.slice(-REGISTRATION_LIMIT).map(startAway);
    return this.#writes.withPermit(
      Effect.uninterruptible(
        Effect.suspend(() =>
          JSON.stringify(next) === JSON.stringify(this.#registrations)
            ? Effect.void
            : writePreferenceFile(this.#path, { version: 1, registrations: next }).pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    this.#registrations = next;
                  }),
                ),
              ),
        ),
      ),
    );
  }
}

/** Each platform has its own registration type, so each branch keeps its own. */
function startAway(registration: StoredPushRegistration): StoredPushRegistration {
  if (registration.platform === "android") return { ...registration, value: { ...registration.value, away: true } };
  return { ...registration, value: { ...registration.value, away: true } };
}

/**
 * An entry that the current contract does not accept is dropped; the phone registers it again. An
 * earlier host drops the Android entries, because the iPhone contract does not accept them.
 */
function decodeFile(parsed: unknown): StoredPushRegistration[] {
  if (!isDynamicRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.registrations)) return [];
  return parsed.registrations.flatMap((entry): StoredPushRegistration[] => {
    if (
      !isDynamicRecord(entry) ||
      !isString(entry.sessionId) ||
      !isString(entry.memberId) ||
      typeof entry.protocol !== "number" ||
      !Array.isArray(entry.capabilities) ||
      !entry.capabilities.every(isString)
    )
      return [];
    const { sessionId, memberId, protocol, capabilities } = entry;
    const threadChoice = typeof entry.threadReplies === "boolean" ? { threadReplies: entry.threadReplies } : {};
    const base = { sessionId, memberId, protocol, capabilities, ...threadChoice };
    try {
      if (entry.platform === "android") {
        const value = readAndroidPushRegistration(decodeAndroidRegistration?.(entry.value));
        return value ? [{ ...base, platform: "android", value }] : [];
      }
      if (entry.platform !== undefined) return [];
      const value = readPushRegistration(decodeRegistration?.(entry.value));
      return value ? [{ ...base, value }] : [];
    } catch {
      return [];
    }
  });
}

/** Reads a registration that the frozen `push-notifications-v1` codec has accepted. */
export function readPushRegistration(value: unknown): PushNotificationRegistration | null {
  if (!isDynamicRecord(value)) return null;
  const {
    serverId,
    token,
    environment,
    secret,
    locale,
    away,
    level,
    mutedUntil,
    preview,
    sound,
    liveActivityStartedAt,
  } = value;
  if (!isString(serverId) || (token !== null && !isString(token)) || !isString(secret) || !isString(locale))
    return null;
  if (environment !== "production" && environment !== "development") return null;
  if (level !== "all" && level !== "needs-me") return null;
  const choice = PUSH_NOTIFICATION_SOUNDS.find((known) => known === sound);
  if (!choice) return null;
  if (typeof away !== "boolean" || typeof preview !== "boolean") return null;
  if (mutedUntil !== null && typeof mutedUntil !== "number") return null;
  if (liveActivityStartedAt !== null && typeof liveActivityStartedAt !== "number") return null;
  return {
    serverId,
    token,
    environment,
    secret,
    locale,
    away,
    level,
    mutedUntil,
    preview,
    sound: choice,
    liveActivityStartedAt,
  };
}

/** Reads a registration that the frozen `push-notifications-android-v1` codec has accepted. */
export function readAndroidPushRegistration(value: unknown): AndroidPushNotificationRegistration | null {
  if (!isDynamicRecord(value)) return null;
  const { serverId, token, secret, locale, away, level, mutedUntil, preview, sound } = value;
  if (!isString(serverId) || !isString(token) || !isString(secret) || !isString(locale)) return null;
  if (level !== "all" && level !== "needs-me") return null;
  const choice = PUSH_NOTIFICATION_SOUNDS.find((known) => known === sound);
  if (!choice) return null;
  if (typeof away !== "boolean" || typeof preview !== "boolean") return null;
  if (mutedUntil !== null && typeof mutedUntil !== "number") return null;
  return { serverId, token, secret, locale, away, level, mutedUntil, preview, sound: choice };
}
