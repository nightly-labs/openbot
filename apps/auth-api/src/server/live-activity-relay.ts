import {
  LIVE_ACTIVITY_SEALED_LIMIT,
  LIVE_ACTIVITY_TOKEN_PATTERN,
  type LiveActivityRelayPush,
} from "@openbot/contracts/live-activity-relay";
import {
  NOTIFICATION_SEALED_LIMIT,
  NOTIFICATION_SOUND_FILES,
  NOTIFICATION_SOUNDS,
  NOTIFICATION_TOKEN_PATTERN,
  type NotificationRelayPush,
  type NotificationSound,
} from "@openbot/contracts/notification-relay";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { Effect, Schema } from "effect";
import { importPKCS8, SignJWT } from "jose";

/**
 * Forwards a sealed iOS Live Activity update or notification from a host to Apple Push Notification
 * service. The host sealed the content with keys that only the phone has, so this service cannot read
 * it. It stores nothing and logs nothing: the token, the host and the bytes live only for the request.
 *
 * This service builds the Apple payload itself. A host gives sealed bytes only, never text: a
 * notification shows the app name until the app opens the seal, and a seal that the app cannot open
 * shows nothing more. A Live Activity alert has the app name only. So a host credential alone, without
 * the keys of the phone, cannot make it show text.
 */

export interface ApnsConfig {
  /** The `.p8` key from Apple, as PEM text. */
  privateKey: string;
  keyId: string;
  teamId: string;
  /** The app bundle ID. */
  topic: string;
  /**
   * Local development only: the development server that forwards to Apple over HTTP/2, which the
   * local Worker runtime cannot open. The path then names the Apple environment.
   */
  origin?: string;
}

export type ApnsRelayResult = "sent" | "gone" | "rejected" | "unavailable";

/** The Live Activity type of the app. It must equal the name the app gives `LiveActivityFactory`. */
const ACTIVITY_NAME = "AgentActivity";
/** The alert title until the app opens the seal. A brand name, so it is the same in every language. */
const NOTIFICATION_TITLE = "OpenBot";
/**
 * The text of a Live Activity alert. iOS shows it on Apple Watch only: the iPhone shows the activity.
 * It is the app name, so Apple sees no agent and no event.
 */
const ACTIVITY_ALERT = { title: NOTIFICATION_TITLE, body: NOTIFICATION_TITLE };
/** Apple keeps a notification this long for a phone that is off. */
const NOTIFICATION_LIFETIME_SECONDS = 24 * 60 * 60;
/**
 * Apple keeps the end of a Live Activity this long for a phone that is off. With no expiry, Apple
 * tries once, and a phone without network keeps showing the old activity.
 */
const LIVE_ACTIVITY_END_LIFETIME_SECONDS = 60 * 60;
/** Apple refuses a provider token older than one hour, and one made again more often than every 20 minutes. */
const TOKEN_REUSE_SECONDS = 50 * 60;
const REQUEST_TIMEOUT_MS = 5_000;
/** Apple answers these for a token that no longer reaches the activity. */
const GONE_REASONS = new Set(["BadDeviceToken", "DeviceTokenNotForTopic", "ExpiredToken", "Unregistered"]);

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

class ApnsProviderError extends Schema.TaggedError<ApnsProviderError>()("ApnsProviderError", {}) {}

export class ApnsRelaySender {
  readonly #config: ApnsConfig;
  readonly #fetch: Fetch;
  readonly #now: () => number;
  #key: Awaited<ReturnType<typeof importPKCS8>> | null = null;
  #token: { value: string; issuedAt: number } | null = null;

  constructor(config: ApnsConfig, fetch: Fetch, now: () => number = Date.now) {
    this.#config = config;
    this.#fetch = fetch;
    this.#now = now;
  }

  readonly send = Effect.fn("ApnsRelaySender.send")(function* (
    this: ApnsRelaySender,
    push: LiveActivityRelayPush,
  ): Effect.fn.Return<ApnsRelayResult, ApnsProviderError> {
    return yield* this.#deliver(
      push,
      {
        "apns-push-type": "liveactivity",
        "apns-topic": `${this.#config.topic}.push-type.liveactivity`,
        "apns-priority": String(push.priority),
        "apns-expiration": String(push.staleAt ?? push.timestamp + LIVE_ACTIVITY_END_LIFETIME_SECONDS),
      },
      liveActivityPayload(push),
    );
  }).bind(this);

  readonly sendNotification = Effect.fn("ApnsRelaySender.sendNotification")(function* (
    this: ApnsRelaySender,
    push: NotificationRelayPush,
  ): Effect.fn.Return<ApnsRelayResult, ApnsProviderError> {
    return yield* this.#deliver(
      push,
      {
        "apns-push-type": "alert",
        "apns-topic": this.#config.topic,
        "apns-priority": "10",
        "apns-expiration": String(push.timestamp + NOTIFICATION_LIFETIME_SECONDS),
      },
      notificationPayload(push),
    );
  }).bind(this);

  readonly #deliver = Effect.fn("ApnsRelaySender.deliver")(function* (
    this: ApnsRelaySender,
    device: { token: string; environment: "production" | "development" },
    headers: Record<string, string>,
    payload: unknown,
  ): Effect.fn.Return<ApnsRelayResult, ApnsProviderError> {
    const sandbox = device.environment === "development";
    const url = this.#config.origin
      ? `${this.#config.origin}/${sandbox ? "sandbox" : "production"}/3/device/${device.token}`
      : `https://${sandbox ? "api.sandbox.push.apple.com" : "api.push.apple.com"}/3/device/${device.token}`;
    const token = yield* this.#providerToken();
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        this.#fetch(url, {
          method: "POST",
          headers: { authorization: `bearer ${token}`, ...headers, "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
        }),
      catch: () => new ApnsProviderError({}),
    }).pipe(Effect.catch(() => Effect.succeed(null)));
    if (!response) return "unavailable";
    if (response.ok) return "sent";
    if (response.status === 410) return "gone";
    if (response.status === 429 || response.status >= 500) return "unavailable";
    const reason = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: () => new ApnsProviderError({}),
    }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ reason: Schema.String }))),
      Effect.map((value) => value.reason),
      Effect.catch(() => Effect.succeed("")),
    );
    if (reason === "ExpiredProviderToken" || reason === "InvalidProviderToken") this.#token = null;
    return GONE_REASONS.has(reason) ? "gone" : "rejected";
  });

  /** Only resolved values cross Worker requests; pending I/O remains with its invocation. */
  readonly #providerToken = Effect.fn("ApnsRelaySender.providerToken")(function* (
    this: ApnsRelaySender,
  ): Effect.fn.Return<string, ApnsProviderError> {
    const now = Math.floor(this.#now() / 1000);
    if (this.#token && now - this.#token.issuedAt < TOKEN_REUSE_SECONDS) return this.#token.value;
    this.#key ??= yield* Effect.tryPromise({
      try: () => importPKCS8(this.#config.privateKey, "ES256"),
      catch: () => new ApnsProviderError({}),
    });
    const key = this.#key;
    const value = yield* Effect.tryPromise({
      try: () =>
        new SignJWT({})
          .setProtectedHeader({ alg: "ES256", kid: this.#config.keyId })
          .setIssuer(this.#config.teamId)
          .setIssuedAt(now)
          .sign(key),
      catch: () => new ApnsProviderError({}),
    });
    this.#token = { value, issuedAt: now };
    return value;
  });
}

function liveActivityPayload(push: LiveActivityRelayPush) {
  return {
    aps: {
      timestamp: push.timestamp,
      event: push.event,
      // The widget opens `sealed` with its keys. An empty value shows the out-of-date view.
      "content-state": { name: ACTIVITY_NAME, props: JSON.stringify({ sealed: push.sealed ?? "" }) },
      ...(push.staleAt === null ? {} : { "stale-date": push.staleAt }),
      ...(push.event === "end" ? { "dismissal-date": push.timestamp } : {}),
      // iOS lights up the screen, shows the activity, and plays the sound.
      ...(push.alert ? { alert: { ...ACTIVITY_ALERT, ...soundField(push.alert.sound) } } : {}),
    },
  };
}

function soundField(sound: NotificationSound | null) {
  if (sound === null) return {};
  return { sound: sound === "default" ? sound : NOTIFICATION_SOUND_FILES[sound] };
}

/**
 * The app replaces the title and adds the text when it opens `sealed`. The thread and the badge come
 * from the app too, so Apple sees no agent and no chat.
 */
function notificationPayload(push: NotificationRelayPush) {
  return {
    aps: { alert: { title: NOTIFICATION_TITLE }, "mutable-content": 1, ...soundField(push.sound) },
    sealed: push.sealed,
  };
}

/** Reads one update from a host request body, or returns `null` when it is not valid. */
export function readLiveActivityRelayPush(body: DynamicRecord): LiveActivityRelayPush | null {
  const { token, environment, event, sealed, timestamp, staleAt, priority, alert } = body;
  if (!isString(token) || !LIVE_ACTIVITY_TOKEN_PATTERN.test(token)) return null;
  if (environment !== "production" && environment !== "development") return null;
  if (event !== "update" && event !== "end") return null;
  if (event === "update") {
    if (!isString(sealed) || sealed.length > LIVE_ACTIVITY_SEALED_LIMIT || !/^[A-Za-z0-9_-]+$/u.test(sealed)) {
      return null;
    }
  } else if (sealed !== null) return null;
  if (!isSeconds(timestamp) || (staleAt !== null && !isSeconds(staleAt))) return null;
  if (priority !== 5 && priority !== 10) return null;
  // A host from before alerts sends no `alert`. An alert takes a sound only, never text.
  let activityAlert: LiveActivityRelayPush["alert"] = null;
  if (alert !== undefined && alert !== null) {
    if (event !== "update" || !isDynamicRecord(alert) || !isSound(alert.sound)) return null;
    activityAlert = { sound: alert.sound };
  }
  return {
    token,
    environment,
    event,
    sealed: event === "update" && isString(sealed) ? sealed : null,
    timestamp,
    staleAt,
    priority,
    alert: activityAlert,
  };
}

/** Reads one notification from a host request body, or returns `null` when it is not valid. */
export function readNotificationRelayPush(body: DynamicRecord): NotificationRelayPush | null {
  const { token, environment, sessionId, sealed, sound, timestamp } = body;
  if (!isString(token) || !NOTIFICATION_TOKEN_PATTERN.test(token)) return null;
  if (environment !== "production" && environment !== "development") return null;
  if (!isString(sessionId) || !sessionId || sessionId.length > 128) return null;
  if (!isString(sealed) || !sealed || sealed.length > NOTIFICATION_SEALED_LIMIT || !/^[A-Za-z0-9_-]+$/u.test(sealed)) {
    return null;
  }
  if (!isSound(sound)) return null;
  if (!isSeconds(timestamp)) return null;
  return { token, environment, sessionId, sealed, sound, timestamp };
}

function isSound(value: unknown): value is NotificationSound | null {
  return value === null || NOTIFICATION_SOUNDS.some((sound) => sound === value);
}

function isSeconds(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

let shared: { config: ApnsConfig; sender: ApnsRelaySender } | null = null;

/** One sender for each key, so the key import and the provider token are reused. */
export function sharedApnsSender(config: ApnsConfig): ApnsRelaySender {
  if (
    shared &&
    shared.config.privateKey === config.privateKey &&
    shared.config.keyId === config.keyId &&
    shared.config.teamId === config.teamId &&
    shared.config.topic === config.topic &&
    shared.config.origin === config.origin
  ) {
    return shared.sender;
  }
  const sender = new ApnsRelaySender(config, (input, init) => fetch(input, init));
  shared = { config, sender };
  return sender;
}
