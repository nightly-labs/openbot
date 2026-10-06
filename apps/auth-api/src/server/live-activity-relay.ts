import {
  LIVE_ACTIVITY_SEALED_LIMIT,
  LIVE_ACTIVITY_TOKEN_PATTERN,
  type LiveActivityRelayPush,
} from "@openbot/contracts/live-activity-relay";
import { type DynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { Effect, Schema } from "effect";
import { importPKCS8, SignJWT } from "jose";

/**
 * Forwards a sealed iOS Live Activity update from a host to Apple Push Notification service. The host
 * sealed the content with keys that only the phone has, so this service cannot read it. It stores
 * nothing and logs nothing: the token, the host and the bytes live only for the request.
 *
 * This service builds the Apple payload itself. A host gives the sealed props only, never text for
 * an alert, so a host credential cannot send an ordinary notification to a phone.
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

export type LiveActivityRelayResult = "sent" | "gone" | "rejected" | "unavailable";

/** The Live Activity type of the app. It must equal the name the app gives `LiveActivityFactory`. */
const ACTIVITY_NAME = "AgentActivity";
/** Apple refuses a provider token older than one hour, and one made again more often than every 20 minutes. */
const TOKEN_REUSE_SECONDS = 50 * 60;
const REQUEST_TIMEOUT_MS = 5_000;
/** Apple answers these for a token that no longer reaches the activity. */
const GONE_REASONS = new Set(["BadDeviceToken", "DeviceTokenNotForTopic", "ExpiredToken", "Unregistered"]);

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

class ApnsProviderError extends Schema.TaggedError<ApnsProviderError>()("ApnsProviderError", {}) {}

export class ApnsLiveActivitySender {
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

  readonly send = Effect.fn("ApnsLiveActivitySender.send")(function* (
    this: ApnsLiveActivitySender,
    push: LiveActivityRelayPush,
  ): Effect.fn.Return<LiveActivityRelayResult, ApnsProviderError> {
    const sandbox = push.environment === "development";
    const url = this.#config.origin
      ? `${this.#config.origin}/${sandbox ? "sandbox" : "production"}/3/device/${push.token}`
      : `https://${sandbox ? "api.sandbox.push.apple.com" : "api.push.apple.com"}/3/device/${push.token}`;
    const token = yield* this.#providerToken();
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        this.#fetch(url, {
          method: "POST",
          headers: {
            authorization: `bearer ${token}`,
            "apns-push-type": "liveactivity",
            "apns-topic": `${this.#config.topic}.push-type.liveactivity`,
            "apns-priority": String(push.priority),
            "apns-expiration": String(push.staleAt ?? 0),
            "content-type": "application/json",
          },
          body: JSON.stringify(apnsPayload(push)),
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
  }).bind(this);

  /** Only resolved values cross Worker requests; pending I/O remains with its invocation. */
  readonly #providerToken = Effect.fn("ApnsLiveActivitySender.providerToken")(function* (
    this: ApnsLiveActivitySender,
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

function apnsPayload(push: LiveActivityRelayPush) {
  return {
    aps: {
      timestamp: push.timestamp,
      event: push.event,
      // The widget opens `sealed` with its keys. An empty value shows the out-of-date view.
      "content-state": { name: ACTIVITY_NAME, props: JSON.stringify({ sealed: push.sealed ?? "" }) },
      ...(push.staleAt === null ? {} : { "stale-date": push.staleAt }),
      ...(push.event === "end" ? { "dismissal-date": push.timestamp } : {}),
    },
  };
}

/** Reads one update from a host request body, or returns `null` when it is not valid. */
export function readLiveActivityRelayPush(body: DynamicRecord): LiveActivityRelayPush | null {
  const { token, environment, event, sealed, timestamp, staleAt, priority } = body;
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
  return {
    token,
    environment,
    event,
    sealed: event === "update" && isString(sealed) ? sealed : null,
    timestamp,
    staleAt,
    priority,
  };
}

function isSeconds(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

let shared: { config: ApnsConfig; sender: ApnsLiveActivitySender } | null = null;

/** One sender for each key, so the key import and the provider token are reused. */
export function sharedApnsSender(config: ApnsConfig): ApnsLiveActivitySender {
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
  const sender = new ApnsLiveActivitySender(config, (input, init) => fetch(input, init));
  shared = { config, sender };
  return sender;
}
