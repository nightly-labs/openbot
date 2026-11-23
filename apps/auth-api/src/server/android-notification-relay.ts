import {
  type AndroidNotificationRelayPush,
  NOTIFICATION_SEALED_LIMIT,
  NOTIFICATION_SOUNDS,
  type NotificationSound,
} from "@openbot/contracts/notification-relay";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { ANDROID_PUSH_TOKEN_PATTERN } from "@openbot/contracts/team-protocol/push-notifications-android-v1";
import { Effect, Schema } from "effect";
import { importPKCS8, SignJWT } from "jose";

export interface FcmConfig {
  projectId: string;
  clientEmail: string;
  privateKey: string;
  privateKeyId: string | null;
}

export type FcmRelayResult = "sent" | "gone" | "rejected" | "unavailable";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const MESSAGING_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const ASSERTION_LIFETIME_SECONDS = 60 * 60;
const TOKEN_MARGIN_SECONDS = 5 * 60;
const NOTIFICATION_LIFETIME = "86400s";
const REQUEST_TIMEOUT_MS = 5_000;
const GONE_ERRORS = new Set(["UNREGISTERED", "SENDER_ID_MISMATCH"]);

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

class FcmProviderError extends Schema.TaggedError<FcmProviderError>()("FcmProviderError", {}) {}

const AccessToken = Schema.Struct({ access_token: Schema.String, expires_in: Schema.Number });
const FcmErrorBody = Schema.Struct({
  error: Schema.Struct({
    details: Schema.optional(Schema.Array(Schema.Struct({ errorCode: Schema.optional(Schema.String) }))),
  }),
});

export class FcmRelaySender {
  readonly #config: FcmConfig;
  readonly #fetch: Fetch;
  readonly #now: () => number;
  #key: Awaited<ReturnType<typeof importPKCS8>> | null = null;
  #token: { value: string; expiresAt: number } | null = null;

  constructor(config: FcmConfig, fetch: Fetch, now: () => number = Date.now) {
    this.#config = config;
    this.#fetch = fetch;
    this.#now = now;
  }

  readonly sendNotification = Effect.fn("FcmRelaySender.sendNotification")(function* (
    this: FcmRelaySender,
    push: AndroidNotificationRelayPush,
  ): Effect.fn.Return<FcmRelayResult> {
    const token = yield* this.#accessToken().pipe(Effect.catch(() => Effect.succeed(null)));
    if (!token) return "unavailable";
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        this.#fetch(
          `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.#config.projectId)}/messages:send`,
          {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify(notificationMessage(push)),
            signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
          },
        ),
      catch: () => new FcmProviderError({}),
    }).pipe(Effect.catch(() => Effect.succeed(null)));
    if (!response) return "unavailable";
    if (response.ok) return "sent";
    if (response.status === 401) {
      this.#token = null;
      return "unavailable";
    }
    if (response.status === 429 || response.status >= 500) return "unavailable";
    const errors = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: () => new FcmProviderError({}),
    }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(FcmErrorBody)),
      Effect.map((value) =>
        (value.error.details ?? []).flatMap((detail) => (detail.errorCode ? [detail.errorCode] : [])),
      ),
      Effect.catch(() => Effect.succeed<readonly string[]>([])),
    );
    return response.status === 404 || errors.some((error) => GONE_ERRORS.has(error)) ? "gone" : "rejected";
  }).bind(this);

  readonly #accessToken = Effect.fn("FcmRelaySender.accessToken")(function* (
    this: FcmRelaySender,
  ): Effect.fn.Return<string, FcmProviderError> {
    const now = Math.floor(this.#now() / 1000);
    if (this.#token && now < this.#token.expiresAt - TOKEN_MARGIN_SECONDS) return this.#token.value;
    this.#key ??= yield* Effect.tryPromise({
      try: () => importPKCS8(this.#config.privateKey, "RS256"),
      catch: () => new FcmProviderError({}),
    });
    const key = this.#key;
    const { clientEmail, privateKeyId } = this.#config;
    const assertion = yield* Effect.tryPromise({
      try: () =>
        new SignJWT({ scope: MESSAGING_SCOPE })
          .setProtectedHeader({ alg: "RS256", typ: "JWT", ...(privateKeyId ? { kid: privateKeyId } : {}) })
          .setIssuer(clientEmail)
          .setAudience(TOKEN_URL)
          .setIssuedAt(now)
          .setExpirationTime(now + ASSERTION_LIFETIME_SECONDS)
          .sign(key),
      catch: () => new FcmProviderError({}),
    });
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        this.#fetch(TOKEN_URL, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
            assertion,
          }).toString(),
          signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
        }),
      catch: () => new FcmProviderError({}),
    });
    if (!response.ok) return yield* new FcmProviderError({});
    const value = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: () => new FcmProviderError({}),
    }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(AccessToken)),
      Effect.mapError(() => new FcmProviderError({})),
    );
    this.#token = { value: value.access_token, expiresAt: now + Math.floor(value.expires_in) };
    return value.access_token;
  });
}

function notificationMessage(push: AndroidNotificationRelayPush) {
  return {
    message: {
      token: push.token,
      data: { sealed: push.sealed, ...(push.sound === null ? {} : { sound: push.sound }) },
      android: { priority: "HIGH", ttl: NOTIFICATION_LIFETIME },
    },
  };
}

export function readAndroidNotificationRelayPush(body: DynamicRecord): AndroidNotificationRelayPush | null {
  const { token, sessionId, sealed, sound, timestamp } = body;
  if (!isString(token) || !ANDROID_PUSH_TOKEN_PATTERN.test(token)) return null;
  if (!isString(sessionId) || !sessionId || sessionId.length > 128) return null;
  if (!isString(sealed) || !sealed || sealed.length > NOTIFICATION_SEALED_LIMIT || !/^[A-Za-z0-9_-]+$/u.test(sealed)) {
    return null;
  }
  if (!isSound(sound)) return null;
  if (typeof timestamp !== "number" || !Number.isSafeInteger(timestamp) || timestamp <= 0) return null;
  return { token, sessionId, sealed, sound, timestamp };
}

function isSound(value: unknown): value is NotificationSound | null {
  return value === null || NOTIFICATION_SOUNDS.some((sound) => sound === value);
}

export function readFcmServiceAccount(value: string): FcmConfig | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!isDynamicRecord(parsed) || parsed.type !== "service_account") return null;
  const { project_id: projectId, client_email: clientEmail, private_key: privateKey, private_key_id: keyId } = parsed;
  if (!isString(projectId) || !projectId || !isString(clientEmail) || !clientEmail) return null;
  if (!isString(privateKey) || !privateKey.includes("PRIVATE KEY")) return null;
  return { projectId, clientEmail, privateKey, privateKeyId: isString(keyId) && keyId ? keyId : null };
}

let shared: { serviceAccount: string; sender: FcmRelaySender } | null = null;

export function sharedFcmSender(serviceAccount: string): FcmRelaySender | null {
  if (shared?.serviceAccount === serviceAccount) return shared.sender;
  const config = readFcmServiceAccount(serviceAccount);
  if (!config) return null;
  const sender = new FcmRelaySender(config, (input, init) => fetch(input, init));
  shared = { serviceAccount, sender };
  return sender;
}
