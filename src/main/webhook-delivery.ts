import type { LookupAddress, LookupOptions } from "node:dns";
import { promises as dns } from "node:dns";
import https from "node:https";
import { isIP } from "node:net";
import type { EventJsonValue } from "@openbot/contracts/ipc-events";
import { isEventJsonValue } from "@openbot/contracts/ipc-events";
import { registerSecretValue } from "@openbot/logging";
import { Effect, Result, Schema } from "effect";
import {
  createWebhookSignature,
  isPublicIpAddress,
  WEBHOOK_MAX_BODY_BYTES,
  webhookSigningBytes,
} from "./webhook-security";

export const WEBHOOK_DELIVERY_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Index zero is the initial attempt. The remaining entries are the five retries. */
export const WEBHOOK_RETRY_DELAYS_MS = [0, 10_000, 60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000] as const;
export const WEBHOOK_MAX_TEMPLATE_DEPTH = 16;
export const WEBHOOK_MAX_CUSTOM_HEADERS = 32;
export const WEBHOOK_MAX_CUSTOM_HEADER_BYTES = 64 * 1024;
export const WEBHOOK_MAX_RESPONSE_BYTES = 64 * 1024;
export const WEBHOOK_DNS_TIMEOUT_MS = 10_000;
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RETRY_DELAYS_MS.length;

export type WebhookHttpMethod = "POST" | "PUT" | "PATCH";

export type WebhookDeliveryFailureCode =
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

export interface WebhookDestination {
  url: string;
  method: WebhookHttpMethod;
  /** Additional headers. OpenBot signature and framing headers are controlled by this module. */
  headers?: Readonly<Record<string, string>>;
  /** JSON values with `{{event.*}}` substitutions. */
  template?: unknown;
}

/** The identity required to sign a stored body. It intentionally contains no user content. */
export interface OutboundWebhookEventIdentity {
  id: string;
  type: string;
}

/** The fields available to outbound templates. It intentionally contains no user content. */
export interface OutboundWebhookEvent extends OutboundWebhookEventIdentity {
  runId: string;
  occurredAt: string;
  routineId?: string | null;
  routineName?: string | null;
  status?: "started" | "succeeded" | "failed" | "needs_attention" | "needs-attention" | null;
}

export interface WebhookDeliveryAttemptInput {
  /** A stored body needs only this identity; template rendering needs the full event. */
  event: OutboundWebhookEventIdentity | OutboundWebhookEvent;
  destination: WebhookDestination;
  /** The plaintext secret exists only for the duration of one attempt. */
  secret: string | Uint8Array;
  /** Stored bytes make retries byte-for-byte stable. */
  body?: Uint8Array;
  /** Zero-based attempt number. The first attempt is 0. */
  attempt?: number;
  /** The persistent delivery deadline. */
  expiresAt?: number;
  nowMs?: number;
}

export interface PreparedWebhookRequest {
  eventId: string;
  body: Buffer;
  timestamp: string;
  method: WebhookHttpMethod;
  url: URL;
  headers: Readonly<Record<string, string>>;
}

export interface WebhookDnsLookup {
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
  setTimeout(milliseconds: number, listener: () => void): this;
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
export function validateDestination(destination: WebhookDestination): void {
  if (!destination || typeof destination !== "object") throw deliveryFailure("invalid_destination");
  if (destination.method !== "POST" && destination.method !== "PUT" && destination.method !== "PATCH")
    throw deliveryFailure("invalid_destination");
  if (typeof destination.url !== "string" || Buffer.byteLength(destination.url, "utf8") > 4096)
    throw deliveryFailure("invalid_destination");
  let url: URL;
  try {
    url = new URL(destination.url);
  } catch {
    throw deliveryFailure("invalid_destination");
  }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname)
    throw deliveryFailure("invalid_destination");
  if (url.port && (!/^\d+$/.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65535))
    throw deliveryFailure("invalid_destination");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) > 0 && !isPublicIpAddress(host)) throw deliveryFailure("private_destination");
  validateHeaders(destination.headers);
  if (destination.template !== undefined) validateWebhookTemplate(destination.template);
}

/** Checks custom headers before they are saved. Signature/framing headers cannot be overridden. */
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

type TemplateValue = string | number | boolean | null | TemplateValue[] | { [key: string]: TemplateValue };

function templatePath(name: string): keyof OutboundWebhookEvent | null {
  switch (name) {
    case "event.id":
      return "id";
    case "event.type":
      return "type";
    case "event.runId":
      return "runId";
    case "event.occurredAt":
      return "occurredAt";
    case "event.routineId":
      return "routineId";
    case "event.routineName":
      return "routineName";
    case "event.status":
      return "status";
    default:
      return null;
  }
}

function validateTemplateValue(value: unknown, depth: number): void {
  if (depth > WEBHOOK_MAX_TEMPLATE_DEPTH) throw deliveryFailure("invalid_template");
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    if (typeof value === "string") {
      if (Buffer.byteLength(value, "utf8") > WEBHOOK_MAX_BODY_BYTES) throw deliveryFailure("invalid_template");
      for (const match of value.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
        if (!match[1] || !templatePath(match[1])) throw deliveryFailure("invalid_template");
      }
    }
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw deliveryFailure("invalid_template");
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 256) throw deliveryFailure("invalid_template");
    for (const child of value) validateTemplateValue(child, depth + 1);
    return;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length > 256) throw deliveryFailure("invalid_template");
    for (const [key, child] of entries) {
      if (!safeString(key) || Buffer.byteLength(key, "utf8") > 256 || UNSAFE_OBJECT_KEYS.has(key.toLowerCase()))
        throw deliveryFailure("invalid_template");
      validateTemplateValue(child, depth + 1);
    }
    return;
  }
  throw deliveryFailure("invalid_template");
}

export function validateWebhookTemplate(template: unknown): void {
  validateTemplateValue(template, 0);
}

function templateEventValue(event: OutboundWebhookEvent, path: string): TemplateValue {
  const field = templatePath(path);
  if (!field) throw deliveryFailure("invalid_template");
  const value = event[field];
  if (value === undefined) return null;
  return value;
}

function renderTemplateValue(value: unknown, event: OutboundWebhookEvent, depth: number): TemplateValue {
  if (depth > WEBHOOK_MAX_TEMPLATE_DEPTH) throw deliveryFailure("invalid_template");
  if (typeof value === "string") {
    const exact = /^\{\{\s*([^{}]+?)\s*\}\}$/.exec(value);
    if (exact?.[1]) return templateEventValue(event, exact[1]);
    return value.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, path: string) => String(templateEventValue(event, path)));
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((child) => renderTemplateValue(child, event, depth + 1));
  if (typeof value === "object") {
    const result: { [key: string]: TemplateValue } = {};
    for (const [key, child] of Object.entries(value)) result[key] = renderTemplateValue(child, event, depth + 1);
    return result;
  }
  throw deliveryFailure("invalid_template");
}

function canonicalize(value: TemplateValue): TemplateValue {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key] === undefined ? null : value[key])]),
    );
  }
  return value;
}

function defaultEventPayload(event: OutboundWebhookEvent): TemplateValue {
  return {
    eventId: event.id,
    eventType: event.type,
    runId: event.runId,
    occurredAt: event.occurredAt,
    routineId: event.routineId ?? null,
    routineName: event.routineName ?? null,
    status: event.status ?? null,
  };
}

/** Builds deterministic JSON. A stored body may be reused across every retry. */
export function buildWebhookBody(event: OutboundWebhookEvent, template?: unknown): Buffer {
  if (!safeString(event.id) || !safeString(event.type) || !safeString(event.runId) || !safeString(event.occurredAt))
    throw deliveryFailure("invalid_template");
  if (template !== undefined) validateWebhookTemplate(template);
  const value = template === undefined ? defaultEventPayload(event) : renderTemplateValue(template, event, 0);
  const body = Buffer.from(JSON.stringify(canonicalize(value)), "utf8");
  if (body.byteLength > WEBHOOK_MAX_BODY_BYTES) throw deliveryFailure("invalid_template");
  return body;
}

function isTemplateEvent(event: OutboundWebhookEventIdentity | OutboundWebhookEvent): event is OutboundWebhookEvent {
  return (
    "runId" in event &&
    "occurredAt" in event &&
    safeString(event.id) &&
    safeString(event.type) &&
    safeString(event.runId) &&
    safeString(event.occurredAt)
  );
}

function assertTemplateEvent(event: OutboundWebhookEventIdentity | OutboundWebhookEvent): OutboundWebhookEvent {
  if (!isTemplateEvent(event)) throw deliveryFailure("invalid_template");
  return event;
}

export function prepareWebhookRequest(input: WebhookDeliveryAttemptInput): PreparedWebhookRequest {
  validateDestination(input.destination);
  const body =
    input.body === undefined
      ? buildWebhookBody(assertTemplateEvent(input.event), input.destination.template)
      : Buffer.from(input.body);
  if (body.byteLength > WEBHOOK_MAX_BODY_BYTES) throw deliveryFailure("invalid_template");
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs)) throw deliveryFailure("invalid_template");
  const timestamp = String(Math.floor(nowMs / 1000));
  const signature = createWebhookSignature(input.secret, timestamp, input.event.id, body);
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
    "content-length": String(body.byteLength),
    "x-openbot-event-id": input.event.id,
    "x-openbot-delivery-id": input.event.id,
    "x-openbot-timestamp": timestamp,
    "x-openbot-signature": signature,
    ...(input.destination.headers ?? {}),
  };
  return {
    eventId: input.event.id,
    body,
    timestamp,
    method: input.destination.method,
    url: new URL(input.destination.url),
    headers,
  };
}

interface ResolvedDestination {
  hostname: string;
  address: string;
  family: 4 | 6;
}

async function lookupWithTimeout(
  lookup: WebhookDnsLookup,
  hostname: string,
  signal?: AbortSignal,
): Promise<readonly LookupAddress[]> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort = (): void => undefined;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const finishSuccess = (addresses: readonly LookupAddress[]): void => finish(() => resolve(addresses));
    const finishFailure = (error: Error): void => finish(() => reject(error));
    onAbort = (): void => finishFailure(new Error("dns-cancelled"));
    timer = setTimeout(() => finishFailure(new Error("dns-timeout")), WEBHOOK_DNS_TIMEOUT_MS);
    timer.unref?.();
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    void Promise.resolve()
      .then(() => lookup.lookup(hostname, { all: true, verbatim: true }))
      .then(finishSuccess, (error: unknown) => finishFailure(error instanceof Error ? error : new Error("dns-failed")));
  });
}

async function resolvePublicDestination(
  url: URL,
  lookup: WebhookDnsLookup,
  signal?: AbortSignal,
): Promise<ResolvedDestination> {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname) > 0) {
    const family = isIP(hostname);
    if ((family !== 4 && family !== 6) || !isPublicIpAddress(hostname)) throw deliveryFailure("private_destination");
    return { hostname, address: hostname, family };
  }
  let addresses: readonly LookupAddress[];
  try {
    addresses = await lookupWithTimeout(lookup, hostname, signal);
  } catch {
    throw deliveryFailure("dns_failed");
  }
  if (addresses.length === 0) throw deliveryFailure("dns_failed");
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
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finishSuccess = (result: HttpResponse) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const finishFailure = (result: WebhookDeliveryError) => {
      if (settled) return;
      settled = true;
      reject(result);
    };
    let client: WebhookRequestHandle | null = null;
    try {
      client = request.request(options, (response) => {
        let bytes = 0;
        response.on("data", (chunk: Buffer | string) => {
          bytes += Buffer.byteLength(chunk);
          if (bytes > WEBHOOK_MAX_RESPONSE_BYTES) {
            response.resume();
            client?.destroy();
            finishFailure(deliveryFailure("response_too_large"));
          }
        });
        response.on("error", () => finishFailure(deliveryFailure("request_failed")));
        response.on("end", () => {
          if (bytes <= WEBHOOK_MAX_RESPONSE_BYTES)
            finishSuccess({ status: response.statusCode ?? 0, retryAfter: responseHeader(response, "retry-after") });
        });
      });
      client.once("error", () => finishFailure(deliveryFailure("request_failed")));
      client.setTimeout(30_000, () => {
        client?.destroy();
        finishFailure(deliveryFailure("request_failed"));
      });
      client.end(body);
    } catch {
      finishFailure(deliveryFailure("request_failed"));
    }
  });
}

export interface WebhookAttemptResult {
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

/** Returns the next allowed time for attempt zero-based `attempt`, or null after five retries. */
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

async function sendWebhookAttemptPromise(
  input: WebhookDeliveryAttemptInput,
  options: { lookup?: WebhookDnsLookup; request?: WebhookHttpsRequester } = {},
  signal?: AbortSignal,
): Promise<WebhookAttemptResult> {
  const prepared = prepareWebhookRequest(input);
  const resolved = await resolvePublicDestination(prepared.url, options.lookup ?? DEFAULT_DNS_LOOKUP, signal);
  for (const value of Object.values(input.destination.headers ?? {})) registerSecretValue(value);
  registerSecretValue(typeof input.secret === "string" ? input.secret : Buffer.from(input.secret).toString("utf8"));
  const lookup = (
    _hostname: string,
    _options: LookupOptions,
    callback: (error: NodeJS.ErrnoException | null, address: string, family: number) => void,
  ): void => {
    callback(null, resolved.address, resolved.family);
  };
  const response = await requestHttps(
    options.request ?? DEFAULT_HTTPS_REQUESTER,
    {
      protocol: "https:",
      hostname: resolved.hostname,
      port: prepared.url.port ? Number(prepared.url.port) : 443,
      path: `${prepared.url.pathname}${prepared.url.search}`,
      method: prepared.method,
      headers: prepared.headers,
      lookup,
      servername: isIP(resolved.hostname) === 0 ? resolved.hostname : undefined,
      agent: false,
      signal,
    },
    prepared.body,
  );
  const nowMs = input.nowMs ?? Date.now();
  if (response.status >= 200 && response.status < 300)
    return { outcome: "succeeded", status: response.status, retryAt: null };
  const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
  if (!retryable) return { outcome: "failed", status: response.status, retryAt: null };
  return {
    outcome: "retryable",
    status: response.status,
    retryAt: nextWebhookRetryAt(input.attempt ?? 0, nowMs, response.retryAfter, input.expiresAt),
  };
}

/** One outbound request, with all native I/O failures reduced to a safe tagged error. */
export const sendWebhookAttempt = Effect.fn("WebhookDelivery.sendAttempt")(function* (
  input: WebhookDeliveryAttemptInput,
  options: { lookup?: WebhookDnsLookup; request?: WebhookHttpsRequester } = {},
): Effect.fn.Return<WebhookAttemptResult, WebhookDeliveryError> {
  return yield* Effect.tryPromise({
    try: (signal) => sendWebhookAttemptPromise(input, options, signal),
    catch: (error) => (error instanceof WebhookDeliveryError ? error : deliveryFailure("request_failed")),
  });
});

export interface StoredWebhookDelivery {
  id: string;
  eventId: string;
  eventType: string;
  url: string;
  method: WebhookHttpMethod;
  /** Event payload snapshot. It is used as-is; no template is evaluated during delivery. */
  payload: EventJsonValue;
  secretCiphertext: string | null;
  headersCiphertext: string | null;
  /** Zero-based claim number. The store consumes one claim atomically before returning it. */
  attempt: number;
  createdAt: string;
  nextAttemptAt: string;
  status?: string;
}

export interface WebhookSecretCipher {
  decrypt(value: Buffer): string;
}

/** The only persistence operations the sender needs. SQLite remains owned by the backend. */
export interface WebhookDeliveryStore {
  /** The store must consume the attempt atomically and return its zero-based claim number. */
  claimDeliveries(limit: number, now: Date): readonly StoredWebhookDelivery[];
  /** Re-checks destination activity after a claim, before any secret is decrypted or sent. */
  isDeliverySendable(id: string): boolean;
  /** Releases a claim without consuming an attempt when the destination is disabled. */
  releaseDelivery(id: string, now: Date): void;
  markDelivery(
    id: string,
    result: {
      status: "succeeded" | "failed" | "queued";
      statusCode?: number | null;
      error?: string | null;
      nextAttemptAt?: string;
    },
    now: Date,
  ): void;
}

export interface WebhookDeliveryWorkerOptions {
  store: WebhookDeliveryStore;
  cipher: WebhookSecretCipher;
  lookup?: WebhookDnsLookup;
  request?: WebhookHttpsRequester;
  now?: () => number;
  maxBatch?: number;
}

export interface WebhookDeliveryRunSummary {
  processed: number;
  succeeded: number;
  retried: number;
  failed: number;
}

/** Runs due outbox rows. It never logs or returns payloads, headers, URLs, or native errors. */
export class WebhookDeliveryWorker {
  readonly #options: WebhookDeliveryWorkerOptions;

  constructor(options: WebhookDeliveryWorkerOptions) {
    this.#options = options;
  }

  readonly runDue = Effect.fn("WebhookDelivery.runDue")((nowMs = this.#options.now?.() ?? Date.now()) =>
    Effect.gen({ self: this }, function* () {
      const rows = yield* Effect.try({
        try: () => this.#options.store.claimDeliveries(this.#options.maxBatch ?? 32, new Date(nowMs)),
        catch: () => deliveryFailure("store_failed"),
      });
      const summary: WebhookDeliveryRunSummary = { processed: rows.length, succeeded: 0, retried: 0, failed: 0 };
      for (const row of rows) {
        const attemptNowMs = this.#options.now?.() ?? Date.now();
        const expiresAt = new Date(row.createdAt).getTime() + WEBHOOK_DELIVERY_WINDOW_MS;
        const secretCiphertext = row.secretCiphertext;
        let result: WebhookAttemptResult;
        const sendable = yield* Effect.try({
          try: () => this.#options.store.isDeliverySendable(row.id),
          catch: () => deliveryFailure("store_failed"),
        });
        if (!sendable) {
          yield* Effect.try({
            try: () => this.#options.store.releaseDelivery(row.id, new Date(attemptNowMs)),
            catch: () => deliveryFailure("store_failed"),
          });
          continue;
        }
        if (
          !Number.isFinite(expiresAt) ||
          attemptNowMs >= expiresAt ||
          !secretCiphertext ||
          row.attempt >= WEBHOOK_MAX_ATTEMPTS
        ) {
          result = { outcome: "failed", status: null, retryAt: null };
        } else {
          const decoded = yield* Effect.result(
            Effect.try({
              try: () => this.#options.cipher.decrypt(Buffer.from(secretCiphertext, "base64")),
              catch: () => deliveryFailure("secret_unavailable"),
            }),
          );
          if (Result.isFailure(decoded) || !decoded.success) {
            result = { outcome: "failed", status: null, retryAt: null };
          } else {
            registerSecretValue(decoded.success);
            const attempted = yield* Effect.result(
              Effect.gen({ self: this }, function* () {
                const headers = yield* Effect.try({
                  try: () => decodeHeaders(row.headersCiphertext, this.#options.cipher),
                  catch: () => deliveryFailure("secret_unavailable"),
                });
                const body = yield* Effect.try({
                  try: () => payloadBody(row.payload),
                  catch: () => deliveryFailure("invalid_template"),
                });
                const destination: WebhookDestination = { url: row.url, method: row.method, headers };
                return yield* sendWebhookAttempt(
                  {
                    event: { id: row.eventId, type: row.eventType },
                    destination,
                    secret: decoded.success,
                    body,
                    attempt: row.attempt,
                    expiresAt,
                    nowMs: attemptNowMs,
                  },
                  { lookup: this.#options.lookup, request: this.#options.request },
                );
              }),
            );
            if (Result.isSuccess(attempted)) result = attempted.success;
            else if (attempted.failure.code === "request_failed" || attempted.failure.code === "dns_failed") {
              const retryAt = nextWebhookRetryAt(row.attempt, attemptNowMs, undefined, expiresAt);
              result = { outcome: retryAt === null ? "failed" : "retryable", status: null, retryAt };
            } else result = { outcome: "failed", status: null, retryAt: null };
          }
        }
        if (result.outcome === "succeeded") {
          yield* Effect.try({
            try: () =>
              this.#options.store.markDelivery(
                row.id,
                { status: "succeeded", statusCode: result.status },
                new Date(attemptNowMs),
              ),
            catch: () => deliveryFailure("store_failed"),
          });
          summary.succeeded += 1;
        } else if (result.outcome === "retryable" && result.retryAt !== null) {
          const retryAt = result.retryAt;
          yield* Effect.try({
            try: () =>
              this.#options.store.markDelivery(
                row.id,
                { status: "queued", statusCode: result.status, nextAttemptAt: new Date(retryAt).toISOString() },
                new Date(attemptNowMs),
              ),
            catch: () => deliveryFailure("store_failed"),
          });
          summary.retried += 1;
        } else {
          yield* Effect.try({
            try: () =>
              this.#options.store.markDelivery(
                row.id,
                { status: "failed", statusCode: result.status },
                new Date(attemptNowMs),
              ),
            catch: () => deliveryFailure("store_failed"),
          });
          summary.failed += 1;
        }
      }
      return summary;
    }),
  );
}

function payloadBody(payload: EventJsonValue): Buffer {
  try {
    const serialized = JSON.stringify(payload);
    if (serialized === undefined) throw deliveryFailure("invalid_template");
    const body = Buffer.from(serialized, "utf8");
    if (body.byteLength > WEBHOOK_MAX_BODY_BYTES) throw deliveryFailure("invalid_template");
    return body;
  } catch (error) {
    if (error instanceof WebhookDeliveryError) throw error;
    throw deliveryFailure("invalid_template");
  }
}

function decodeHeaders(
  ciphertext: string | null,
  cipher: WebhookSecretCipher,
): Readonly<Record<string, string>> | undefined {
  if (!ciphertext) return undefined;
  try {
    const parsed = JSON.parse(cipher.decrypt(Buffer.from(ciphertext, "base64")));
    if (!isEventJsonValue(parsed) || parsed === null || Array.isArray(parsed)) throw new Error();
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(parsed)) {
      if (typeof value !== "string" || UNSAFE_OBJECT_KEYS.has(name.toLowerCase())) throw new Error();
      headers[name] = value;
    }
    validateHeaders(headers);
    return headers;
  } catch {
    throw deliveryFailure("secret_unavailable");
  }
}

// Keep this import used by the signing contract in generated declaration output and make the
// exact bytes contract obvious to callers that persist their own body.
export { webhookSigningBytes };
