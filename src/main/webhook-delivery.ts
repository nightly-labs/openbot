import type { LookupAddress } from "node:dns";
import { promises as dns } from "node:dns";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { type EventJsonValue, isEventJsonValue } from "@openbot/contracts/ipc-events";
import { WEBHOOK_DELIVERY_BODY_BYTES_LIMIT } from "@openbot/contracts/signal-protocol/messages";
import { registerSecretValue } from "@openbot/logging";
import { Effect, Result, Schema } from "effect";
import type { WebhookDestinationStore } from "../backend/webhook-destination-store";
import { createWebhookSignature, isPublicIpAddress } from "./webhook-security";

export const WEBHOOK_DELIVERY_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Index zero is the initial attempt. The remaining entries are the five retries. */
const WEBHOOK_RETRY_DELAYS_MS = [0, 10_000, 60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000] as const;
const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RETRY_DELAYS_MS.length;
const WEBHOOK_MAX_TEMPLATE_DEPTH = 16;
const WEBHOOK_MAX_CUSTOM_HEADERS = 32;
const WEBHOOK_MAX_CUSTOM_HEADER_BYTES = 64 * 1024;
const WEBHOOK_MAX_RESPONSE_BYTES = 64 * 1024;
const WEBHOOK_DNS_TIMEOUT_MS = 10_000;
/** One attempt, from DNS to the end of the response, must finish in this time. */
const WEBHOOK_REQUEST_DEADLINE_MS = 30_000;

/** Placeholders that `materializeTemplate` fills from a run notification. */
const TEMPLATE_FIELDS = new Set([
  "id",
  "type",
  "eventId",
  "eventType",
  "runId",
  "occurredAt",
  "routineId",
  "routineName",
  "status",
]);

type WebhookHttpMethod = "POST" | "PUT" | "PATCH";

type WebhookDeliveryFailureCode =
  | "invalid_destination"
  | "invalid_headers"
  | "invalid_template"
  | "dns_failed"
  | "private_destination"
  | "request_failed"
  | "response_too_large"
  | "secret_unavailable"
  | "store_failed";

/** A safe error. It never stores the URL, secret, body, response, or native cause. */
export class WebhookDeliveryError extends Schema.TaggedError<WebhookDeliveryError>()("WebhookDeliveryError", {
  code: Schema.Literals([
    "invalid_destination",
    "invalid_headers",
    "invalid_template",
    "dns_failed",
    "private_destination",
    "request_failed",
    "response_too_large",
    "secret_unavailable",
    "store_failed",
  ]),
}) {}

export interface WebhookDestinationSettings {
  url: string;
  method: WebhookHttpMethod;
  headers?: Readonly<Record<string, string>>;
  template?: EventJsonValue;
}

export interface WebhookRequestInput {
  /** The outbound delivery ID. A retry keeps it, so the receiver can drop a repeat. */
  deliveryId: string;
  eventId: string;
  url: string;
  method: WebhookHttpMethod;
  headers?: Readonly<Record<string, string>>;
  /** The plaintext secret exists only for the duration of one attempt. No secret sends no signature. */
  secret: string | null;
  /** Stored bytes make retries byte-for-byte stable. */
  body: Uint8Array;
  nowMs?: number;
}

export interface PreparedWebhookRequest {
  body: Buffer;
  method: WebhookHttpMethod;
  url: URL;
  headers: Readonly<Record<string, string>>;
}

interface WebhookDnsLookup {
  lookup(hostname: string, options: { all: true; verbatim: true }): Promise<readonly LookupAddress[]>;
}

export interface WebhookResponseReader {
  statusCode?: number;
  headers: Readonly<Record<string, string | string[] | undefined>>;
  on(event: "data", listener: (chunk: Buffer | string) => void): this;
  on(event: "error", listener: () => void): this;
  on(event: "end", listener: () => void): this;
  resume(): void;
}

export interface WebhookRequestHandle {
  once(event: "error", listener: () => void): this;
  end(body: Buffer): this;
  destroy(): this;
}

export interface WebhookHttpsRequester {
  request(options: https.RequestOptions, callback: (response: WebhookResponseReader) => void): WebhookRequestHandle;
}

const DEFAULT_DNS_LOOKUP: WebhookDnsLookup = {
  lookup: (hostname, options) => dns.lookup(hostname, options),
};

const DEFAULT_HTTPS_REQUESTER: WebhookHttpsRequester = {
  request: (options, callback) => https.request(options, (response) => callback(response)),
};

const FORBIDDEN_HEADER_NAMES = new Set([
  "connection",
  "content-length",
  "content-type",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const UNSAFE_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function deliveryFailure(code: WebhookDeliveryFailureCode): WebhookDeliveryError {
  return new WebhookDeliveryError({ code });
}

function safeString(value: unknown): value is string {
  return typeof value === "string" && !value.includes("\r") && !value.includes("\n");
}

/** Validates metadata at the settings boundary. DNS is checked at send time as well. */
export function validateDestination(destination: WebhookDestinationSettings): void {
  if (destination.method !== "POST" && destination.method !== "PUT" && destination.method !== "PATCH")
    throw deliveryFailure("invalid_destination");
  if (typeof destination.url !== "string" || Buffer.byteLength(destination.url, "utf8") > 2048)
    throw deliveryFailure("invalid_destination");
  let url: URL;
  try {
    url = new URL(destination.url);
  } catch {
    throw deliveryFailure("invalid_destination");
  }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname)
    throw deliveryFailure("invalid_destination");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) > 0 && !isPublicIpAddress(host)) throw deliveryFailure("private_destination");
  validateHeaders(destination.headers);
  if (destination.template !== undefined) validateWebhookTemplate(destination.template);
}

/** Checks custom headers before they are saved. Signature and framing headers cannot be overridden. */
export function validateHeaders(headers: Readonly<Record<string, string>> | undefined): void {
  if (headers === undefined) return;
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) throw deliveryFailure("invalid_headers");
  const names = Object.keys(headers);
  if (names.length > WEBHOOK_MAX_CUSTOM_HEADERS) throw deliveryFailure("invalid_headers");
  let bytes = 0;
  const normalizedNames = new Set<string>();
  for (const name of names) {
    const lower = name.toLowerCase();
    const value = headers[name];
    if (
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(name) ||
      FORBIDDEN_HEADER_NAMES.has(lower) ||
      UNSAFE_OBJECT_KEYS.has(lower) ||
      normalizedNames.has(lower)
    )
      throw deliveryFailure("invalid_headers");
    normalizedNames.add(lower);
    if (lower.startsWith("x-openbot-") || !safeString(value) || Buffer.byteLength(value, "utf8") > 8 * 1024)
      throw deliveryFailure("invalid_headers");
    bytes += Buffer.byteLength(name, "utf8") + Buffer.byteLength(value, "utf8");
  }
  if (bytes > WEBHOOK_MAX_CUSTOM_HEADER_BYTES) throw deliveryFailure("invalid_headers");
}

function validateTemplateValue(value: EventJsonValue, depth: number): void {
  if (depth > WEBHOOK_MAX_TEMPLATE_DEPTH) throw deliveryFailure("invalid_template");
  if (typeof value === "string") {
    for (const match of value.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)) {
      const field = match[1]?.startsWith("event.") ? match[1].slice("event.".length) : match[1];
      if (!field || !TEMPLATE_FIELDS.has(field)) throw deliveryFailure("invalid_template");
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) validateTemplateValue(child, depth + 1);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (!safeString(key) || UNSAFE_OBJECT_KEYS.has(key.toLowerCase())) throw deliveryFailure("invalid_template");
    validateTemplateValue(child, depth + 1);
  }
}

/**
 * Checks a template before it is saved. The backend fills it with `materializeTemplate` when a run
 * notification is queued, so a template can name only the notification fields.
 */
export function validateWebhookTemplate(template: EventJsonValue): void {
  if (!isEventJsonValue(template)) throw deliveryFailure("invalid_template");
  if (Buffer.byteLength(JSON.stringify(template), "utf8") > WEBHOOK_DELIVERY_BODY_BYTES_LIMIT)
    throw deliveryFailure("invalid_template");
  validateTemplateValue(template, 0);
}

export function prepareWebhookRequest(input: WebhookRequestInput): PreparedWebhookRequest {
  validateDestination({ url: input.url, method: input.method, headers: input.headers });
  const body = Buffer.from(input.body);
  if (body.byteLength > WEBHOOK_DELIVERY_BODY_BYTES_LIMIT) throw deliveryFailure("invalid_template");
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs)) throw deliveryFailure("invalid_template");
  const timestamp = String(Math.floor(nowMs / 1000));
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
    "content-length": String(body.byteLength),
    "x-openbot-event-id": input.eventId,
    "x-openbot-delivery-id": input.deliveryId,
    "x-openbot-timestamp": timestamp,
    ...(input.secret === null
      ? {}
      : { "x-openbot-signature": createWebhookSignature(input.secret, timestamp, input.deliveryId, body) }),
    ...(input.headers ?? {}),
  };
  return { body, method: input.method, url: new URL(input.url), headers };
}

interface ResolvedDestination {
  hostname: string;
  address: string;
  family: 4 | 6;
}

async function lookupWithTimeout(
  lookup: WebhookDnsLookup,
  hostname: string,
  signal: AbortSignal,
): Promise<readonly LookupAddress[]> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = (): void => finish(() => reject(new Error("dns-cancelled")));
    const timer = setTimeout(() => finish(() => reject(new Error("dns-timeout"))), WEBHOOK_DNS_TIMEOUT_MS);
    timer.unref?.();
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    void Promise.resolve()
      .then(() => lookup.lookup(hostname, { all: true, verbatim: true }))
      .then(
        (addresses) => finish(() => resolve(addresses)),
        () => finish(() => reject(new Error("dns-failed"))),
      );
  });
}

async function resolvePublicDestination(
  url: URL,
  lookup: WebhookDnsLookup,
  signal: AbortSignal,
): Promise<ResolvedDestination> {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const literal = isIP(hostname);
  if (literal > 0) {
    if ((literal !== 4 && literal !== 6) || !isPublicIpAddress(hostname)) throw deliveryFailure("private_destination");
    return { hostname, address: hostname, family: literal };
  }
  let addresses: readonly LookupAddress[];
  try {
    addresses = await lookupWithTimeout(lookup, hostname, signal);
  } catch {
    throw deliveryFailure("dns_failed");
  }
  // Reject the whole hostname if any answer is unsafe. This prevents an attacker from returning a
  // public answer first and a private rebinding answer second.
  for (const result of addresses) {
    if ((result.family !== 4 && result.family !== 6) || !isPublicIpAddress(result.address))
      throw deliveryFailure("private_destination");
  }
  const first = addresses[0];
  if (!first || (first.family !== 4 && first.family !== 6)) throw deliveryFailure("dns_failed");
  return { hostname, address: first.address, family: first.family };
}

/**
 * Pins the connection to the address that passed the public-address check. Node asks for every
 * address when `autoSelectFamily` is on, so the callback answers in the form that was requested.
 */
function pinnedLookup(resolved: ResolvedDestination): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) callback(null, [{ address: resolved.address, family: resolved.family }]);
    else callback(null, resolved.address, resolved.family);
  };
}

function responseHeader(response: WebhookResponseReader, name: string): string | undefined {
  const value = response.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

interface HttpResponse {
  status: number;
  retryAfter?: string;
}

function requestHttps(
  request: WebhookHttpsRequester,
  options: https.RequestOptions,
  body: Buffer,
  signal: AbortSignal,
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let client: WebhookRequestHandle | null = null;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const fail = (code: WebhookDeliveryFailureCode): void => finish(() => reject(deliveryFailure(code)));
    // The deadline applies even to a requester that ignores `signal`.
    const onAbort = (): void => {
      client?.destroy();
      fail("request_failed");
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) return onAbort();
    try {
      client = request.request(options, (response) => {
        let bytes = 0;
        response.on("data", (chunk: Buffer | string) => {
          bytes += Buffer.byteLength(chunk);
          if (bytes > WEBHOOK_MAX_RESPONSE_BYTES) {
            response.resume();
            client?.destroy();
            fail("response_too_large");
          }
        });
        response.on("error", () => fail("request_failed"));
        response.on("end", () =>
          finish(() =>
            resolve({ status: response.statusCode ?? 0, retryAfter: responseHeader(response, "retry-after") }),
          ),
        );
      });
      client.once("error", () => fail("request_failed"));
      client.end(body);
    } catch {
      fail("request_failed");
    }
  });
}

interface WebhookAttemptResult {
  outcome: "succeeded" | "retryable" | "failed";
  status: number | null;
  retryAt: number | null;
}

function retryAfterDelay(value: string | undefined, nowMs: number): number | null {
  if (!value || !safeString(value)) return null;
  if (/^\d+$/.test(value)) return Math.min(Number(value) * 1000, WEBHOOK_DELIVERY_WINDOW_MS);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.min(WEBHOOK_DELIVERY_WINDOW_MS, timestamp - nowMs));
}

/** Returns the next allowed time after zero-based `attempt`, or null after five retries or the window. */
export function nextWebhookRetryAt(
  attempt: number,
  nowMs: number,
  retryAfter: string | undefined,
  expiresAt = nowMs + WEBHOOK_DELIVERY_WINDOW_MS,
): number | null {
  const delay = WEBHOOK_RETRY_DELAYS_MS[attempt + 1];
  if (delay === undefined) return null;
  const retryAfterMs = retryAfterDelay(retryAfter, nowMs) ?? 0;
  const next = nowMs + Math.max(delay, retryAfterMs);
  return next <= expiresAt ? next : null;
}

export interface WebhookTransport {
  lookup?: WebhookDnsLookup;
  request?: WebhookHttpsRequester;
  /** Overrides `WEBHOOK_REQUEST_DEADLINE_MS`. */
  deadlineMs?: number;
}

async function sendWebhookRequestPromise(
  input: WebhookRequestInput,
  transport: WebhookTransport,
  cancelled: AbortSignal,
): Promise<HttpResponse> {
  const prepared = prepareWebhookRequest(input);
  for (const value of Object.values(input.headers ?? {})) registerSecretValue(value);
  if (input.secret !== null) registerSecretValue(input.secret);
  const signal = AbortSignal.any([cancelled, AbortSignal.timeout(transport.deadlineMs ?? WEBHOOK_REQUEST_DEADLINE_MS)]);
  const resolved = await resolvePublicDestination(prepared.url, transport.lookup ?? DEFAULT_DNS_LOOKUP, signal);
  return requestHttps(
    transport.request ?? DEFAULT_HTTPS_REQUESTER,
    {
      protocol: "https:",
      hostname: resolved.hostname,
      port: prepared.url.port ? Number(prepared.url.port) : 443,
      path: `${prepared.url.pathname}${prepared.url.search}`,
      method: prepared.method,
      headers: prepared.headers,
      lookup: pinnedLookup(resolved),
      servername: isIP(resolved.hostname) === 0 ? resolved.hostname : undefined,
      agent: false,
      signal,
    },
    prepared.body,
    signal,
  );
}

/** One outbound request, with all native I/O failures reduced to a safe tagged error. */
export const sendWebhookRequest = Effect.fn("WebhookDelivery.sendRequest")(function* (
  input: WebhookRequestInput,
  transport: WebhookTransport = {},
): Effect.fn.Return<HttpResponse, WebhookDeliveryError> {
  return yield* Effect.tryPromise({
    try: (signal) => sendWebhookRequestPromise(input, transport, signal),
    catch: (error) => (error instanceof WebhookDeliveryError ? error : deliveryFailure("request_failed")),
  });
});

export interface WebhookSecretCipher {
  decrypt(value: Buffer): string;
}

export interface WebhookDeliveryWorkerOptions extends WebhookTransport {
  store: Pick<WebhookDestinationStore, "claim" | "isSendable" | "release" | "settle">;
  cipher: WebhookSecretCipher;
  now?: () => number;
  maxBatch?: number;
}

interface WebhookDeliveryRunSummary {
  processed: number;
  succeeded: number;
  retried: number;
  failed: number;
}

/** Sends due outbox rows. It never logs or returns payloads, headers, URLs, or native errors. */
export class WebhookDeliveryWorker {
  readonly #options: WebhookDeliveryWorkerOptions;

  constructor(options: WebhookDeliveryWorkerOptions) {
    this.#options = options;
  }

  readonly runDue = Effect.fn("WebhookDelivery.runDue")(function* (this: WebhookDeliveryWorker) {
    const store = this.#options.store;
    const now = () => this.#options.now?.() ?? Date.now();
    const rows = yield* storeStep(() => store.claim(this.#options.maxBatch ?? 32, new Date(now())));
    const summary: WebhookDeliveryRunSummary = { processed: rows.length, succeeded: 0, retried: 0, failed: 0 };
    for (const row of rows) {
      const attemptNowMs = now();
      if (!(yield* storeStep(() => store.isSendable(row.id)))) {
        yield* storeStep(() => store.release(row.id, new Date(attemptNowMs)));
        continue;
      }
      // The claim counts this attempt, so `row.attempt` is one-based.
      const attempt = row.attempt - 1;
      const expiresAt = Date.parse(row.windowStartedAt) + WEBHOOK_DELIVERY_WINDOW_MS;
      let result: WebhookAttemptResult = { outcome: "failed", status: null, retryAt: null };
      if (Number.isFinite(expiresAt) && attemptNowMs < expiresAt && attempt < WEBHOOK_MAX_ATTEMPTS) {
        const sent = yield* Effect.result(
          Effect.gen({ self: this }, function* () {
            const secret = yield* Effect.try({
              try: () => decryptOptional(row.secretCiphertext, this.#options.cipher),
              catch: () => deliveryFailure("secret_unavailable"),
            });
            const headers = yield* Effect.try({
              try: () => decodeHeaders(row.headersCiphertext, this.#options.cipher),
              catch: () => deliveryFailure("secret_unavailable"),
            });
            return yield* sendWebhookRequest(
              {
                deliveryId: row.id,
                eventId: row.eventId,
                url: row.url,
                method: row.method,
                headers,
                secret,
                body: Buffer.from(JSON.stringify(row.payload), "utf8"),
                nowMs: attemptNowMs,
              },
              this.#options,
            );
          }),
        );
        if (Result.isSuccess(sent)) {
          const { status, retryAfter } = sent.success;
          if (status >= 200 && status < 300) result = { outcome: "succeeded", status, retryAt: null };
          else if (status === 408 || status === 429 || status >= 500) {
            const retryAt = nextWebhookRetryAt(attempt, attemptNowMs, retryAfter, expiresAt);
            result = { outcome: "retryable", status, retryAt };
          } else result = { outcome: "failed", status, retryAt: null };
        } else if (sent.failure.code === "request_failed" || sent.failure.code === "dns_failed") {
          const retryAt = nextWebhookRetryAt(attempt, attemptNowMs, undefined, expiresAt);
          result = { outcome: "retryable", status: null, retryAt };
        }
      }
      const settledAt = new Date(attemptNowMs);
      const { status: statusCode, retryAt } = result;
      if (result.outcome === "succeeded") {
        yield* storeStep(() => store.settle(row.id, { status: "succeeded", statusCode }, settledAt));
        summary.succeeded += 1;
      } else if (retryAt !== null) {
        const nextAttemptAt = new Date(retryAt).toISOString();
        yield* storeStep(() => store.settle(row.id, { status: "queued", statusCode, nextAttemptAt }, settledAt));
        summary.retried += 1;
      } else {
        yield* storeStep(() => store.settle(row.id, { status: "failed", statusCode }, settledAt));
        summary.failed += 1;
      }
    }
    return summary;
  }).bind(this);
}

function storeStep<A>(operation: () => A): Effect.Effect<A, WebhookDeliveryError> {
  return Effect.try({ try: operation, catch: () => deliveryFailure("store_failed") });
}

function decryptOptional(ciphertext: string | null, cipher: WebhookSecretCipher): string | null {
  if (ciphertext === null) return null;
  const secret = cipher.decrypt(Buffer.from(ciphertext, "base64"));
  if (!secret) throw deliveryFailure("secret_unavailable");
  return secret;
}

function decodeHeaders(
  ciphertext: string | null,
  cipher: WebhookSecretCipher,
): Readonly<Record<string, string>> | undefined {
  if (!ciphertext) return undefined;
  const parsed = JSON.parse(cipher.decrypt(Buffer.from(ciphertext, "base64")));
  if (!isEventJsonValue(parsed) || parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    throw deliveryFailure("secret_unavailable");
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (typeof value !== "string" || UNSAFE_OBJECT_KEYS.has(name.toLowerCase()))
      throw deliveryFailure("secret_unavailable");
    headers[name] = value;
  }
  validateHeaders(headers);
  return headers;
}
