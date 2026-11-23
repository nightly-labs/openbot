import type {
  CreditMediaGenerationKind,
  CreditMediaInputRole,
  CreditMediaJobStatus,
} from "@openbot/contracts/credit-media";
import { type DynamicRecord, isDynamicRecord, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { Effect, Schema } from "effect";

const REQUEST_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const DOWNLOAD_REDIRECT_HOPS = 3;
const DEFAULT_POLL_SECONDS = 5;
const UPSTREAM_STATUSES: readonly CreditMediaJobStatus[] = ["queued", "processing", "completed", "failed", "canceled"];

export const ROUTER_MEDIA_UPSTREAM = "router";
export const TASKS_MEDIA_UPSTREAM = "tasks";

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

export interface MediaGenerationInput {
  role: CreditMediaInputRole;
  bytes: Uint8Array;
  mimeType: string;
}

export interface MediaGeneration {
  kind: CreditMediaGenerationKind;
  model: string;
  params: MediaUpstreamBody;
  prompt: string;
  aspect: string | null;
  resolution: string | null;
  count: number;
  duration: number | null;
  audio: boolean | null;
  inputs: readonly MediaGenerationInput[];
}

export interface MediaUpstream {
  submit(idempotencyKey: string, generation: MediaGeneration): Effect.Effect<MediaUpstreamJob, MediaUpstreamError>;
  status(providerJobId: string): Effect.Effect<MediaUpstreamJob, MediaUpstreamError>;
  result(providerJobId: string): Effect.Effect<MediaUpstreamArtifact[], MediaUpstreamError>;
  download(url: string): Effect.Effect<Response, MediaUpstreamError>;
}

export type MediaUpstreams = ReadonlyMap<string, MediaUpstream>;

export interface MediaUpstreamReply {
  response: Response;
  body: DynamicRecord | null;
}

export function payload(body: DynamicRecord | null): DynamicRecord | null {
  const data = body && "data" in body ? body.data : body;
  return isDynamicRecord(data) ? data : null;
}

function jsonRecord(value: unknown): DynamicRecord | null {
  return isDynamicRecord(value) ? value : null;
}

function safeCode(value: unknown): string | null {
  return isString(value) && /^[a-z0-9_.-]{1,64}$/i.test(value) ? value : null;
}

function errorCode(body: DynamicRecord | null): string {
  if (!body || !isDynamicRecord(body.error)) return "unknown";
  return safeCode(body.error.code) ?? safeCode(body.error.type) ?? "unknown";
}

function retryAfter(response: Response): number | null {
  const value = Number(response.headers.get("Retry-After"));
  return Number.isFinite(value) && value > 0 ? Math.min(3_600, Math.ceil(value)) : null;
}

export function pollSeconds(value: unknown): number {
  return isNumber(value) && Number.isFinite(value) && value > 0 ? Math.min(60, Math.ceil(value)) : DEFAULT_POLL_SECONDS;
}

export function readStatus(value: unknown): CreditMediaJobStatus | null {
  if (isOneOf(UPSTREAM_STATUSES, value)) return value;
  if (value === "succeeded" || value === "success") return "completed";
  if (value === "cancelled") return "canceled";
  if (value === "running" || value === "in_progress") return "processing";
  return null;
}

export function invalidResponse(): MediaUpstreamError {
  return new MediaUpstreamError({ status: 502, code: "invalid_response", retryAfterSeconds: null });
}

export function validJobId(value: unknown): value is string {
  return isString(value) && value.length > 0 && value.length <= 200;
}

function readJob(body: DynamicRecord | null): MediaUpstreamJob | null {
  const data = payload(body);
  if (!data) return null;
  const job = isDynamicRecord(data.job) ? data.job : data;
  const id = job.id;
  const status = readStatus(job.status);
  if (!validJobId(id) || !status) return null;
  return { id, status, pollAfterSeconds: pollSeconds(data.next_poll_after_seconds ?? job.next_poll_after_seconds) };
}

export function optionalNumber(value: unknown): number | null {
  return isNumber(value) && Number.isFinite(value) && value >= 0 ? value : null;
}

export function mediaType(value: unknown): string | null {
  const mimeType = isString(value) ? value.split(";")[0]?.trim() : undefined;
  return mimeType && /^(image|video|audio)\/[a-z0-9.+-]+$/i.test(mimeType) ? mimeType : null;
}

function readArtifacts(body: DynamicRecord | null): MediaUpstreamArtifact[] | null {
  const data = payload(body);
  if (!data) return null;
  const result = isDynamicRecord(data.result) ? data.result : data;
  if (!Array.isArray(result.artifacts)) return null;
  return result.artifacts.flatMap((artifact) => {
    if (!isDynamicRecord(artifact) || !isString(artifact.url) || !artifact.url.startsWith("https://")) return [];
    return [
      {
        url: artifact.url,
        mimeType: mediaType(artifact.content_type) ?? "application/octet-stream",
        width: optionalNumber(artifact.width),
        height: optionalNumber(artifact.height),
        durationMs: optionalNumber(artifact.duration_ms),
      },
    ];
  });
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function dataUri(input: MediaGenerationInput): string {
  return `data:${input.mimeType};base64,${base64(input.bytes)}`;
}

export function present<Value>(entries: Record<string, Value | undefined | null>): Readonly<Record<string, Value>> {
  const body: Record<string, Value> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined && value !== null) body[key] = value;
  }
  return body;
}

export function inputsOf(generation: MediaGeneration, role: CreditMediaInputRole): MediaGenerationInput[] {
  return generation.inputs.filter((input) => input.role === role);
}

export class MediaUpstreamHttp {
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #fetch: MediaUpstreamFetch;

  constructor(options: MediaUpstreamOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetch;
  }

  request(
    path: string,
    init: RequestInit & { idempotencyKey?: string },
  ): Effect.Effect<MediaUpstreamReply, MediaUpstreamError> {
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

  readonly download = Effect.fn("MediaUpstream.download")(function* (
    this: MediaUpstreamHttp,
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

function routerBody(generation: MediaGeneration): MediaUpstreamBody {
  const references = inputsOf(generation, "reference").map(dataUri);
  const [first] = inputsOf(generation, "first");
  const [last] = inputsOf(generation, "last");
  const shared = {
    ...generation.params,
    model: generation.model,
    prompt: generation.prompt,
    aspect_ratio: generation.aspect,
    resolution: generation.resolution,
  };
  if (generation.kind === "image")
    return present<MediaUpstreamValue>({
      ...shared,
      num_images: generation.count,
      image_urls: references.length > 0 ? references : undefined,
    });
  return present<MediaUpstreamValue>({
    ...shared,
    duration: generation.duration,
    image_url: first ? dataUri(first) : undefined,
    end_image_url: last ? dataUri(last) : undefined,
    reference_image_urls: references.length > 0 ? references : undefined,
    generate_audio: generation.audio,
  });
}

export class RouterMediaUpstream implements MediaUpstream {
  readonly #http: MediaUpstreamHttp;

  constructor(options: MediaUpstreamOptions) {
    this.#http = new MediaUpstreamHttp(options);
  }

  readonly submit = Effect.fn("RouterMediaUpstream.submit")(function* (
    this: RouterMediaUpstream,
    idempotencyKey: string,
    generation: MediaGeneration,
  ): Effect.fn.Return<MediaUpstreamJob, MediaUpstreamError> {
    const { body: response } = yield* this.#http.request(`/v1/${generation.kind}-router/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(routerBody(generation)),
      idempotencyKey,
    });
    const job = readJob(response);
    if (!job) return yield* invalidResponse();
    return job;
  }).bind(this);

  readonly status = Effect.fn("RouterMediaUpstream.status")(function* (
    this: RouterMediaUpstream,
    providerJobId: string,
  ): Effect.fn.Return<MediaUpstreamJob, MediaUpstreamError> {
    const { body } = yield* this.#http.request(`/v1/jobs/${encodeURIComponent(providerJobId)}/status`, {});
    const job = readJob(body);
    if (!job) return yield* invalidResponse();
    return job;
  }).bind(this);

  readonly result = Effect.fn("RouterMediaUpstream.result")(function* (
    this: RouterMediaUpstream,
    providerJobId: string,
  ): Effect.fn.Return<MediaUpstreamArtifact[], MediaUpstreamError> {
    const { body } = yield* this.#http.request(`/v1/jobs/${encodeURIComponent(providerJobId)}/result`, {});
    const artifacts = readArtifacts(body);
    if (!artifacts) return yield* invalidResponse();
    return artifacts;
  }).bind(this);

  download(url: string): Effect.Effect<Response, MediaUpstreamError> {
    return this.#http.download(url);
  }
}
