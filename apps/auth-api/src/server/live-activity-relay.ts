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
import { WATCH_WIDGET_PUSH_TOKEN_PATTERN } from "@openbot/contracts/watch-protocol";
import { Effect, Schema } from "effect";
import { importPKCS8, SignJWT } from "jose";

export interface ApnsConfig {
  privateKey: string;
  keyId: string;
  teamId: string;
  topic: string;
  origin?: string;
}

export type ApnsRelayResult = "sent" | "gone" | "rejected" | "unavailable";

export interface WidgetRelayPush {
  token: string;
  environment: "production" | "development";
}

function watchWidgetPushTopic(appTopic: string): string {
  return `${appTopic}.watchkitapp.push-type.widgets`;
}

const ACTIVITY_NAME = "AgentActivity";
const NOTIFICATION_TITLE = "OpenBot";
const ACTIVITY_ALERT = { title: NOTIFICATION_TITLE, body: NOTIFICATION_TITLE };
const NOTIFICATION_LIFETIME_SECONDS = 24 * 60 * 60;
const LIVE_ACTIVITY_END_LIFETIME_SECONDS = 60 * 60;
const TOKEN_REUSE_SECONDS = 50 * 60;
const REQUEST_TIMEOUT_MS = 5_000;
const WIDGET_PUSH_LIFETIME_SECONDS = 60 * 60;
const WIDGET_PUSH_PAYLOAD = { aps: { "content-changed": true } };
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

  readonly sendWidgetPush = Effect.fn("ApnsRelaySender.sendWidgetPush")(function* (
    this: ApnsRelaySender,
    push: WidgetRelayPush,
  ): Effect.fn.Return<ApnsRelayResult, ApnsProviderError> {
    return yield* this.#deliver(
      push,
      {
        "apns-push-type": "widgets",
        "apns-topic": watchWidgetPushTopic(this.#config.topic),
        "apns-priority": "5",
        "apns-expiration": String(Math.floor(this.#now() / 1000) + WIDGET_PUSH_LIFETIME_SECONDS),
      },
      WIDGET_PUSH_PAYLOAD,
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
      "content-state": { name: ACTIVITY_NAME, props: JSON.stringify({ sealed: push.sealed ?? "" }) },
      ...(push.staleAt === null ? {} : { "stale-date": push.staleAt }),
      ...(push.event === "end" ? { "dismissal-date": push.timestamp } : {}),
      ...(push.alert ? { alert: { ...ACTIVITY_ALERT, ...soundField(push.alert.sound) } } : {}),
    },
  };
}

function soundField(sound: NotificationSound | null) {
  if (sound === null) return {};
  return { sound: sound === "default" ? sound : NOTIFICATION_SOUND_FILES[sound] };
}

function notificationPayload(push: NotificationRelayPush) {
  return {
    aps: { alert: { title: NOTIFICATION_TITLE }, "mutable-content": 1, ...soundField(push.sound) },
    sealed: push.sealed,
  };
}

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

export function readWidgetRelayPush(body: DynamicRecord): WidgetRelayPush | null {
  const { token, environment } = body;
  if (!isString(token) || !WATCH_WIDGET_PUSH_TOKEN_PATTERN.test(token)) return null;
  if (environment !== "production" && environment !== "development") return null;
  return { token, environment };
}

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
