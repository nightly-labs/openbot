import type {
  CreditMediaGenerationKind,
  CreditMediaInputRole,
  CreditMediaJobStatus,
} from "@openbot/contracts/credit-media";
import { type DynamicRecord, isDynamicRecord, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { Effect, Schema } from "effect";

const GATEWAY_ORIGIN = "https://openbot-media-gateway.internal";
const REQUEST_TIMEOUT_MS = 30_000;
const OUTPUT_TIMEOUT_MS = 150_000;
const DEFAULT_POLL_SECONDS = 5;
const JOB_STATUSES: readonly CreditMediaJobStatus[] = ["queued", "processing", "completed", "failed", "canceled"];
const UPSTREAM_NAME = /^[a-z0-9_-]{1,40}$/;

export const LEGACY_MEDIA_UPSTREAM = "router";
const MEDIA_GATEWAY_REQUEST_PART = "request";

export class MediaGatewayError extends Schema.TaggedError<MediaGatewayError>()("MediaGatewayError", {
  status: Schema.Number,
  code: Schema.String,
  retryAfterSeconds: Schema.NullOr(Schema.Number),
}) {}

export type MediaGatewayFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type MediaFunding = "paid" | "welcome";

export interface MediaGatewayModel {
  id: string;
  upstream: string;
  specs: DynamicRecord;
  welcomeUpstream: string | null;
}

export interface MediaGatewayInput {
  role: CreditMediaInputRole;
  bytes: Uint8Array;
  mimeType: string;
}

export interface MediaGatewayGeneration {
  jobId: string;
  model: string;
  upstream: string;
  funding: MediaFunding;
  kind: CreditMediaGenerationKind;
  prompt: string;
  aspect: string | null;
  resolution: string | null;
  count: number;
  duration: number | null;
  audio: boolean | null;
  inputs: readonly MediaGatewayInput[];
}

export interface MediaGatewayJob {
  upstream: string;
  id: string;
  status: CreditMediaJobStatus;
  pollAfterSeconds: number;
  failure: string | null;
}

export interface MediaGatewayArtifact {
  mimeType: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

export interface MediaGateway {
  models(upstream: string | null): Effect.Effect<MediaGatewayModel[], MediaGatewayError>;
  submit(generation: MediaGatewayGeneration): Effect.Effect<MediaGatewayJob, MediaGatewayError>;
  status(upstream: string, id: string): Effect.Effect<MediaGatewayJob, MediaGatewayError>;
  result(upstream: string, id: string): Effect.Effect<MediaGatewayArtifact[], MediaGatewayError>;
  output(upstream: string, id: string, index: number): Effect.Effect<Response, MediaGatewayError>;
}

const SAFE_CODE = /^[a-z0-9_.-]{1,64}$/i;

function safeCode(value: unknown): string {
  return isString(value) && SAFE_CODE.test(value) ? value : "unknown";
}

function jobFailure(status: CreditMediaJobStatus, value: unknown): string | null {
  if (status !== "failed") return null;
  return isString(value) && SAFE_CODE.test(value) ? value.toLowerCase() : "unknown";
}

function retryAfter(response: Response): number | null {
  const value = Number(response.headers.get("Retry-After"));
  return Number.isFinite(value) && value > 0 ? Math.min(3_600, Math.ceil(value)) : null;
}

function invalidResponse(): MediaGatewayError {
  return new MediaGatewayError({ status: 502, code: "invalid_response", retryAfterSeconds: null });
}

function networkError(): MediaGatewayError {
  return new MediaGatewayError({ status: 0, code: "network", retryAfterSeconds: null });
}

function upstreamName(value: unknown): string | null {
  return isString(value) && UPSTREAM_NAME.test(value) ? value : null;
}

function optionalNumber(value: unknown): number | null {
  return isNumber(value) && Number.isFinite(value) && value >= 0 ? value : null;
}

function mediaType(value: unknown): string | null {
  const mimeType = isString(value) ? value.split(";")[0]?.trim() : undefined;
  return mimeType && /^(image|video|audio)\/[a-z0-9.+-]+$/i.test(mimeType) ? mimeType : null;
}

function pollSeconds(value: unknown): number {
  return isNumber(value) && Number.isFinite(value) && value > 0 ? Math.min(60, Math.ceil(value)) : DEFAULT_POLL_SECONDS;
}

function readModel(value: unknown): MediaGatewayModel[] {
  if (!isDynamicRecord(value) || !isString(value.id) || value.id.length === 0) return [];
  const upstream = upstreamName(value.upstream);
  if (!upstream) return [];
  const welcome = isDynamicRecord(value.welcome) ? upstreamName(value.welcome.upstream) : null;
  return [{ id: value.id, upstream, specs: isDynamicRecord(value.specs) ? value.specs : {}, welcomeUpstream: welcome }];
}

function readJob(body: DynamicRecord | null): MediaGatewayJob | null {
  if (!body) return null;
  const upstream = upstreamName(body.upstream);
  const id = body.id;
  if (!upstream || !isString(id) || id.length === 0 || id.length > 200) return null;
  if (!isOneOf(JOB_STATUSES, body.status)) return null;
  return {
    upstream,
    id,
    status: body.status,
    pollAfterSeconds: pollSeconds(body.pollAfterSeconds),
    failure: jobFailure(body.status, body.failure),
  };
}

function readArtifacts(body: DynamicRecord | null): MediaGatewayArtifact[] | null {
  if (!body || !Array.isArray(body.artifacts)) return null;
  return body.artifacts.map((artifact) => {
    const entry = isDynamicRecord(artifact) ? artifact : {};
    return {
      mimeType: mediaType(entry.mimeType) ?? "application/octet-stream",
      width: optionalNumber(entry.width),
      height: optionalNumber(entry.height),
      durationMs: optionalNumber(entry.durationMs),
    };
  });
}

function jobPath(upstream: string, id: string): string {
  return `/v1/jobs/${encodeURIComponent(upstream)}/${encodeURIComponent(id)}`;
}

function generationForm(generation: MediaGatewayGeneration): FormData {
  const { inputs, ...request } = generation;
  const form = new FormData();
  form.set(MEDIA_GATEWAY_REQUEST_PART, JSON.stringify(request));
  for (const input of inputs)
    form.append(input.role, new Blob([new Uint8Array(input.bytes)], { type: input.mimeType }), input.role);
  return form;
}

export class HttpMediaGateway implements MediaGateway {
  readonly #fetch: MediaGatewayFetch;

  constructor(fetch: MediaGatewayFetch) {
    this.#fetch = fetch;
  }

  #send(path: string, init: RequestInit, timeoutMs: number): Effect.Effect<Response, MediaGatewayError> {
    return Effect.tryPromise({
      try: () => this.#fetch(`${GATEWAY_ORIGIN}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) }),
      catch: networkError,
    }).pipe(
      Effect.flatMap((response) =>
        response.ok
          ? Effect.succeed(response)
          : Effect.promise(() => response.json().catch(() => null)).pipe(
              Effect.flatMap((body) =>
                Effect.fail(
                  new MediaGatewayError({
                    status: response.status,
                    code: safeCode(isDynamicRecord(body) && isDynamicRecord(body.error) ? body.error.code : null),
                    retryAfterSeconds: retryAfter(response),
                  }),
                ),
              ),
            ),
      ),
    );
  }

  #json(path: string, init: RequestInit = {}): Effect.Effect<DynamicRecord | null, MediaGatewayError> {
    return this.#send(path, { ...init, headers: { Accept: "application/json" } }, REQUEST_TIMEOUT_MS).pipe(
      Effect.flatMap((response) =>
        Effect.tryPromise({ try: () => response.json(), catch: invalidResponse }).pipe(
          Effect.map((body) => (isDynamicRecord(body) ? body : null)),
        ),
      ),
    );
  }

  readonly models = Effect.fn("MediaGateway.models")(function* (
    this: HttpMediaGateway,
    upstream: string | null,
  ): Effect.fn.Return<MediaGatewayModel[], MediaGatewayError> {
    const query = upstream === null ? "" : `?upstream=${encodeURIComponent(upstream)}`;
    const body = yield* this.#json(`/v1/models${query}`);
    if (!body || !Array.isArray(body.models)) return yield* invalidResponse();
    return body.models.flatMap(readModel);
  }).bind(this);

  readonly submit = Effect.fn("MediaGateway.submit")(function* (
    this: HttpMediaGateway,
    generation: MediaGatewayGeneration,
  ): Effect.fn.Return<MediaGatewayJob, MediaGatewayError> {
    const job = readJob(yield* this.#json("/v1/jobs", { method: "POST", body: generationForm(generation) }));
    if (!job) return yield* invalidResponse();
    return job;
  }).bind(this);

  readonly status = Effect.fn("MediaGateway.status")(function* (
    this: HttpMediaGateway,
    upstream: string,
    id: string,
  ): Effect.fn.Return<MediaGatewayJob, MediaGatewayError> {
    const job = readJob(yield* this.#json(jobPath(upstream, id)));
    if (!job) return yield* invalidResponse();
    return job;
  }).bind(this);

  readonly result = Effect.fn("MediaGateway.result")(function* (
    this: HttpMediaGateway,
    upstream: string,
    id: string,
  ): Effect.fn.Return<MediaGatewayArtifact[], MediaGatewayError> {
    const artifacts = readArtifacts(yield* this.#json(`${jobPath(upstream, id)}/result`));
    if (!artifacts) return yield* invalidResponse();
    return artifacts;
  }).bind(this);

  readonly output = Effect.fn("MediaGateway.output")(function* (
    this: HttpMediaGateway,
    upstream: string,
    id: string,
    index: number,
  ): Effect.fn.Return<Response, MediaGatewayError> {
    const response = yield* this.#send(`${jobPath(upstream, id)}/outputs/${index}`, {}, OUTPUT_TIMEOUT_MS);
    if (!response.body) return yield* invalidResponse();
    return response;
  }).bind(this);
}

export function mediaGatewayFromBinding(binding: Fetcher | undefined): MediaGateway | null {
  if (!binding) return null;
  return new HttpMediaGateway((input, init) => binding.fetch(input, init));
}
