import type { CreditMediaGenerationKind, CreditMediaJobStatus } from "@openbot/contracts/credit-media";
import { type DynamicRecord, isDynamicRecord, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { Effect, Schema } from "effect";

const REQUEST_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const DOWNLOAD_REDIRECT_HOPS = 3;
const DEFAULT_POLL_SECONDS = 5;
const UPSTREAM_STATUSES: readonly CreditMediaJobStatus[] = ["queued", "processing", "completed", "failed", "canceled"];

export class MediaUpstreamError extends Schema.TaggedError<MediaUpstreamError>()("MediaUpstreamError", {
  status: Schema.Number,
  code: Schema.String,
  retryAfterSeconds: Schema.NullOr(Schema.Number),
}) {}

export type MediaUpstreamFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface MediaUpstreamOptions {
  baseUrl: string;
  apiKey: string;
  fetch: MediaUpstreamFetch;
}

export interface MediaUpstreamJob {
  id: string;
  status: CreditMediaJobStatus;
  pollAfterSeconds: number;
}

export interface MediaUpstreamArtifact {
  url: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

export type MediaUpstreamValue = string | number | boolean | null | readonly string[];
export type MediaUpstreamBody = Readonly<Record<string, MediaUpstreamValue>>;

function payload(body: DynamicRecord | null): DynamicRecord | null {
  const data = body && "data" in body ? body.data : body;
  return isDynamicRecord(data) ? data : null;
}

function jsonRecord(value: unknown): DynamicRecord | null {
  return isDynamicRecord(value) ? value : null;
}

function errorCode(body: DynamicRecord | null): string {
  if (!body || !isDynamicRecord(body.error)) return "unknown";
  const code = body.error.code;
  return isString(code) && /^[a-z0-9_.-]{1,64}$/i.test(code) ? code : "unknown";
}

function retryAfter(response: Response): number | null {
  const value = Number(response.headers.get("Retry-After"));
  return Number.isFinite(value) && value > 0 ? Math.min(3_600, Math.ceil(value)) : null;
}

function pollSeconds(value: unknown): number {
  return isNumber(value) && Number.isFinite(value) && value > 0 ? Math.min(60, Math.ceil(value)) : DEFAULT_POLL_SECONDS;
}

function readStatus(value: unknown): CreditMediaJobStatus | null {
  if (isOneOf(UPSTREAM_STATUSES, value)) return value;
  if (value === "succeeded" || value === "success") return "completed";
  if (value === "cancelled") return "canceled";
  if (value === "running" || value === "in_progress") return "processing";
  return null;
}

function readJob(body: DynamicRecord | null): MediaUpstreamJob | null {
  const data = payload(body);
  if (!data) return null;
  const job = isDynamicRecord(data.job) ? data.job : data;
  const id = job.id;
  const status = readStatus(job.status);
  if (!isString(id) || id.length === 0 || id.length > 200 || !status) return null;
  return { id, status, pollAfterSeconds: pollSeconds(data.next_poll_after_seconds ?? job.next_poll_after_seconds) };
}

function optionalNumber(value: unknown): number | null {
  return isNumber(value) && Number.isFinite(value) && value >= 0 ? value : null;
}

function readArtifacts(body: DynamicRecord | null): MediaUpstreamArtifact[] | null {
  const data = payload(body);
  if (!data) return null;
  const result = isDynamicRecord(data.result) ? data.result : data;
  if (!Array.isArray(result.artifacts)) return null;
  return result.artifacts.flatMap((artifact) => {
    if (!isDynamicRecord(artifact) || !isString(artifact.url) || !artifact.url.startsWith("https://")) return [];
    const mimeType = isString(artifact.content_type) ? artifact.content_type.split(";")[0]?.trim() : undefined;
    return [
      {
        url: artifact.url,
        mimeType:
          mimeType && /^(image|video|audio)\/[a-z0-9.+-]+$/i.test(mimeType) ? mimeType : "application/octet-stream",
        width: optionalNumber(artifact.width),
        height: optionalNumber(artifact.height),
        durationMs: optionalNumber(artifact.duration_ms),
      },
    ];
  });
}

export class MediaUpstream {
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #fetch: MediaUpstreamFetch;

  constructor(options: MediaUpstreamOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetch;
  }

  #request(
    path: string,
    init: RequestInit & { idempotencyKey?: string },
  ): Effect.Effect<{ response: Response; body: DynamicRecord | null }, MediaUpstreamError> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.#apiKey}`);
    headers.set("Accept", "application/json");
    if (init.idempotencyKey) headers.set("Idempotency-Key", init.idempotencyKey);
    return Effect.tryPromise({
      try: async () => {
        const response = await this.#fetch(`${this.#baseUrl}${path}`, {
          method: init.method ?? "GET",
          headers,
          body: init.body ?? null,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        const body = jsonRecord(await response.json().catch(() => null));
        return { response, body };
      },
      catch: () => new MediaUpstreamError({ status: 0, code: "network", retryAfterSeconds: null }),
    }).pipe(
      Effect.flatMap(({ response, body }) =>
        response.ok
          ? Effect.succeed({ response, body })
          : Effect.fail(
              new MediaUpstreamError({
                status: response.status,
                code: errorCode(body),
                retryAfterSeconds: retryAfter(response),
              }),
            ),
      ),
    );
  }

  readonly submit = Effect.fn("MediaUpstream.submit")(function* (
    this: MediaUpstream,
    kind: CreditMediaGenerationKind,
    idempotencyKey: string,
    body: MediaUpstreamBody,
  ): Effect.fn.Return<MediaUpstreamJob, MediaUpstreamError> {
    const { body: response } = yield* this.#request(`/v1/${kind}-router/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      idempotencyKey,
    });
    const job = readJob(response);
    if (!job) return yield* new MediaUpstreamError({ status: 502, code: "invalid_response", retryAfterSeconds: null });
    return job;
  }).bind(this);

  readonly status = Effect.fn("MediaUpstream.status")(function* (
    this: MediaUpstream,
    providerJobId: string,
  ): Effect.fn.Return<MediaUpstreamJob, MediaUpstreamError> {
    const { body } = yield* this.#request(`/v1/jobs/${encodeURIComponent(providerJobId)}/status`, {});
    const job = readJob(body);
    if (!job) return yield* new MediaUpstreamError({ status: 502, code: "invalid_response", retryAfterSeconds: null });
    return job;
  }).bind(this);

  readonly result = Effect.fn("MediaUpstream.result")(function* (
    this: MediaUpstream,
    providerJobId: string,
  ): Effect.fn.Return<MediaUpstreamArtifact[], MediaUpstreamError> {
    const { body } = yield* this.#request(`/v1/jobs/${encodeURIComponent(providerJobId)}/result`, {});
    const artifacts = readArtifacts(body);
    if (!artifacts)
      return yield* new MediaUpstreamError({ status: 502, code: "invalid_response", retryAfterSeconds: null });
    return artifacts;
  }).bind(this);

  readonly download = Effect.fn("MediaUpstream.download")(function* (
    this: MediaUpstream,
    url: string,
  ): Effect.fn.Return<Response, MediaUpstreamError> {
    const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
    const origin = new URL(this.#baseUrl).origin;
    let target = url;
    for (let hop = 0; hop <= DOWNLOAD_REDIRECT_HOPS; hop += 1) {
      const headers = new Headers();
      if (new URL(target).origin === origin) headers.set("Authorization", `Bearer ${this.#apiKey}`);
      const response = yield* Effect.tryPromise({
        try: () => this.#fetch(target, { headers, redirect: "manual", signal }),
        catch: () => new MediaUpstreamError({ status: 0, code: "network", retryAfterSeconds: null }),
      });
      const location = response.headers.get("Location");
      if (response.status >= 300 && response.status < 400 && location) {
        target = new URL(location, target).href;
        continue;
      }
      if (!response.ok || !response.body)
        return yield* new MediaUpstreamError({ status: response.status, code: "download", retryAfterSeconds: null });
      return response;
    }
    return yield* new MediaUpstreamError({ status: 508, code: "download", retryAfterSeconds: null });
  }).bind(this);
}

export function mediaUpstreamFromBindings(bindings: {
  MEDIA_API_URL?: string | undefined;
  MEDIA_API_KEY?: string | undefined;
}): MediaUpstream | null {
  if (!bindings.MEDIA_API_URL || !bindings.MEDIA_API_KEY) return null;
  return new MediaUpstream({
    baseUrl: bindings.MEDIA_API_URL,
    apiKey: bindings.MEDIA_API_KEY,
    fetch: (input, init) => fetch(input, init),
  });
}
