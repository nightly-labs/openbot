import {
  CREDIT_MEDIA_INPUT_LIMIT_BYTES,
  CREDIT_MEDIA_INPUT_TYPES,
  CREDIT_MEDIA_INPUTS_LIMIT_BYTES,
  CREDIT_MEDIA_KINDS,
  CREDIT_MEDIA_REQUEST_PART,
  type CreditMediaBalance,
  type CreditMediaCatalog,
  type CreditMediaFailure,
  type CreditMediaInputRole,
  type CreditMediaJob,
  type CreditMediaJobRequest,
  type CreditMediaJobStatus,
  type CreditMediaModel,
  type CreditMediaOutput,
  creditMediaCost,
  creditMediaRequestProblem,
  creditMediaRequiredInput,
  parseCreditMediaJobRequest,
  parseCreditMediaModel,
} from "@openbot/contracts/credit-media";
import { creditsFromTenths } from "@openbot/contracts/credits";
import {
  type DynamicRecord,
  isBoolean,
  isDynamicRecord,
  isNumber,
  isOneOf,
  isString,
} from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result } from "effect";
import type { AccountAnalytics } from "./account-analytics";
import { BillingError, BillingOperationError, billingCall } from "./billing-errors";
import {
  availableTenthsSql,
  type CreditHold,
  type CreditHoldOutcome,
  type CreditJobCheck,
  type CreditJobChecker,
  CreditSpending,
  type CreditWallet,
} from "./credit-spending";
import type {
  MediaUpstream,
  MediaUpstreamArtifact,
  MediaUpstreamBody,
  MediaUpstreamError,
  MediaUpstreamValue,
} from "./media-upstream";

type Failure = BillingError | BillingOperationError;

const QUEUED_POLL_SECONDS = 5;
const REQUEST_BODY_LIMIT_BYTES = CREDIT_MEDIA_INPUTS_LIMIT_BYTES + 1024 * 1024;
const REFUSED_STATUSES = new Set([400, 404, 413, 415, 422]);
const NOT_ACCEPTED_STATUSES = new Set([401, 402, 403, 429]);

export type CreditMediaPayer = { wallet: "personal"; userId: string } | { wallet: "server"; serverId: string };

interface CreditMediaInput {
  role: CreditMediaInputRole;
  bytes: Uint8Array;
  mimeType: string;
}

export interface CreditMediaSubmission {
  request: CreditMediaJobRequest;
  inputs: readonly CreditMediaInput[];
}

export interface CreditMediaServiceOptions {
  database: D1Database;
  upstream: MediaUpstream | null;
  now: () => number;
  analytics?: AccountAnalytics;
}

interface ModelRow {
  model_id: string;
  upstream_id: string;
  kind: string;
  name: string;
  maker: string;
  variant: string | null;
  specs: string;
  upstream_params: string;
  resolution: string;
  unit: string;
  credits: number;
  silent_credits: number | null;
}

interface StoredModel {
  model: CreditMediaModel;
  upstreamId: string;
  upstreamParams: MediaUpstreamBody;
}

function parseJsonRecord(text: string): DynamicRecord | null {
  try {
    const value = JSON.parse(text);
    return isDynamicRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function upstreamParams(text: string): MediaUpstreamBody {
  const value = parseJsonRecord(text);
  if (!value) return {};
  const params: Record<string, MediaUpstreamValue> = {};
  for (const [key, item] of Object.entries(value)) {
    if (isString(item) || isNumber(item) || isBoolean(item)) params[key] = item;
  }
  return params;
}

function storedModels(rows: readonly ModelRow[]): StoredModel[] {
  const grouped = new Map<string, ModelRow[]>();
  for (const row of rows) grouped.set(row.model_id, [...(grouped.get(row.model_id) ?? []), row]);
  return [...grouped.values()].flatMap((group) => {
    const first = group[0];
    if (!first) return [];
    const model = parseCreditMediaModel({
      ...parseJsonRecord(first.specs),
      id: first.model_id,
      kind: first.kind,
      name: first.name,
      maker: first.maker,
      variant: first.variant,
      prices: group.map((row) => ({
        resolution: row.resolution === "" ? null : row.resolution,
        unit: row.unit,
        credits: row.credits,
        silentCredits: row.silent_credits,
      })),
    });
    return model
      ? [{ model, upstreamId: first.upstream_id, upstreamParams: upstreamParams(first.upstream_params) }]
      : [];
  });
}

function walletOf(payer: CreditMediaPayer): CreditWallet {
  return payer.wallet === "personal" ? { userId: payer.userId } : { serverId: payer.serverId };
}

function owns(payer: CreditMediaPayer, hold: CreditHold): boolean {
  return payer.wallet === "personal"
    ? hold.userId === payer.userId && hold.serverId === null
    : hold.serverId === payer.serverId && hold.userId === null;
}

function failureOf(outcome: CreditHoldOutcome | null): CreditMediaFailure {
  if (outcome === "refused" || outcome === "canceled" || outcome === "expired") return outcome;
  return "failed";
}

function outputsOf(artifacts: readonly MediaUpstreamArtifact[]): CreditMediaOutput[] {
  return artifacts.map((artifact, index) => ({
    index,
    mimeType: artifact.mimeType,
    width: artifact.width,
    height: artifact.height,
    durationMs: artifact.durationMs,
  }));
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function dataUri(input: CreditMediaInput): string {
  return `data:${input.mimeType};base64,${base64(input.bytes)}`;
}

function present(entries: Record<string, MediaUpstreamValue | undefined>): MediaUpstreamBody {
  const body: Record<string, MediaUpstreamValue> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined && value !== null) body[key] = value;
  }
  return body;
}

function upstreamBody(stored: StoredModel, submission: CreditMediaSubmission): MediaUpstreamBody {
  const { request, inputs } = submission;
  const first = inputs.find((input) => input.role === "first");
  const last = inputs.find((input) => input.role === "last");
  const references = inputs.filter((input) => input.role === "reference").map(dataUri);
  const shared = {
    ...stored.upstreamParams,
    model: stored.upstreamId,
    prompt: request.prompt,
    aspect_ratio: request.aspect ?? stored.model.defaultAspect,
    resolution: request.resolution ?? stored.model.defaultResolution,
  };
  if (stored.model.kind === "image")
    return present({
      ...shared,
      num_images: request.count,
      image_urls: references.length > 0 ? references : undefined,
    });
  return present({
    ...shared,
    duration: request.duration ?? stored.model.defaultDuration,
    image_url: first ? dataUri(first) : undefined,
    end_image_url: last ? dataUri(last) : undefined,
    reference_image_urls: references.length > 0 ? references : undefined,
    generate_audio: stored.model.audio ? request.audio : undefined,
  });
}

function inputsProblem(model: CreditMediaModel, inputs: readonly CreditMediaInput[]): boolean {
  const count = (role: CreditMediaInputRole) => inputs.filter((input) => input.role === role).length;
  if (count("first") > (model.frames >= 1 ? 1 : 0)) return true;
  if (count("last") > (model.frames >= 2 ? 1 : 0)) return true;
  if (count("last") > 0 && count("first") === 0) return true;
  if (count("reference") > model.references) return true;
  const required = creditMediaRequiredInput(model);
  if (required !== null && count(required) === 0) return true;
  const total = inputs.reduce((sum, input) => sum + input.bytes.byteLength, 0);
  return (
    total > CREDIT_MEDIA_INPUTS_LIMIT_BYTES ||
    inputs.some(
      (input) =>
        input.bytes.byteLength === 0 ||
        input.bytes.byteLength > CREDIT_MEDIA_INPUT_LIMIT_BYTES ||
        !isOneOf(CREDIT_MEDIA_INPUT_TYPES, input.mimeType),
    )
  );
}

function unavailable(): BillingError {
  return new BillingError(503, "media_unavailable", sourceText("error.billing.mediaUnavailable"));
}

function busy(): BillingError {
  return new BillingError(503, "media_busy", sourceText("error.billing.mediaBusy"));
}

function invalidRequest(): BillingError {
  return new BillingError(400, "media_request_invalid", sourceText("error.billing.mediaRequestInvalid"));
}

function notFound(): BillingError {
  return new BillingError(404, "media_job_not_found", sourceText("error.billing.mediaJobNotFound"));
}

function logUpstream(operation: string, error: MediaUpstreamError): void {
  console.error("media: upstream request failed", { operation, status: error.status, code: error.code });
}

function readFile(value: FormDataEntryValue): Effect.Effect<Uint8Array | null, Failure> {
  if (isString(value)) return Effect.succeed(null);
  return billingCall(() => value.arrayBuffer()).pipe(Effect.map((buffer) => new Uint8Array(buffer)));
}

export const readCreditMediaSubmission = Effect.fn("CreditMedia.readSubmission")(function* (
  request: Request,
): Effect.fn.Return<CreditMediaSubmission, Failure> {
  const length = Number(request.headers.get("Content-Length") ?? "0");
  if (!Number.isFinite(length) || length > REQUEST_BODY_LIMIT_BYTES) return yield* invalidRequest();
  const form = yield* billingCall(() => request.formData()).pipe(Effect.mapError(() => invalidRequest()));
  const head = form.get(CREDIT_MEDIA_REQUEST_PART);
  const parsed = isString(head) ? parseCreditMediaJobRequest(parseJsonRecord(head)) : null;
  if (!parsed) return yield* invalidRequest();
  const inputs: CreditMediaInput[] = [];
  for (const role of ["first", "last", "reference"] as const) {
    for (const entry of form.getAll(role)) {
      const bytes = yield* readFile(entry);
      if (!bytes || isString(entry)) return yield* invalidRequest();
      inputs.push({ role, bytes, mimeType: entry.type.split(";")[0]?.trim().toLowerCase() ?? "" });
    }
  }
  return { request: parsed, inputs };
});

export class CreditMediaService {
  readonly #database: D1Database;
  readonly #upstream: MediaUpstream | null;
  readonly #spending: CreditSpending;

  constructor(options: CreditMediaServiceOptions) {
    this.#database = options.database;
    this.#upstream = options.upstream;
    this.#spending = new CreditSpending({
      database: options.database,
      now: options.now,
      ...(options.analytics ? { analytics: options.analytics } : {}),
    });
  }

  #models(modelId: string | null): Effect.Effect<StoredModel[], Failure> {
    return billingCall(() =>
      this.#database
        .prepare(
          `SELECT m.model_id, m.upstream_id, m.kind, m.name, m.maker, m.variant, m.specs, m.upstream_params,
                  p.resolution, p.unit, p.credits, p.silent_credits
             FROM credit_media_models m
             JOIN credit_media_prices p ON p.model_id = m.model_id
            WHERE m.enabled = 1 AND (?1 IS NULL OR m.model_id = ?1)
            ORDER BY m.kind, m.position, m.model_id, p.resolution`,
        )
        .bind(modelId)
        .all<ModelRow>(),
    ).pipe(Effect.map((result) => storedModels(result.results)));
  }

  #upstreamOrFail(): Effect.Effect<MediaUpstream, BillingError> {
    return this.#upstream ? Effect.succeed(this.#upstream) : Effect.fail(unavailable());
  }

  readonly catalog = Effect.fn("CreditMedia.catalog")(function* (
    this: CreditMediaService,
  ): Effect.fn.Return<CreditMediaCatalog, Failure> {
    if (!this.#upstream) return { models: [] };
    const models = yield* this.#models(null);
    return {
      models: CREDIT_MEDIA_KINDS.flatMap((kind) =>
        models.filter((stored) => stored.model.kind === kind).map((stored) => stored.model),
      ),
    };
  }).bind(this);

  readonly balance = Effect.fn("CreditMedia.balance")(function* (
    this: CreditMediaService,
    payer: CreditMediaPayer,
  ): Effect.fn.Return<CreditMediaBalance, Failure> {
    const column = payer.wallet === "personal" ? "user_id" : "server_id";
    const id = payer.wallet === "personal" ? payer.userId : payer.serverId;
    const row = yield* billingCall(() =>
      this.#database
        .prepare(`SELECT ${availableTenthsSql(column, "?1")} AS available_tenths`)
        .bind(id)
        .first<{ available_tenths: number }>(),
    );
    return { wallet: payer.wallet, available: creditsFromTenths(Math.max(0, row?.available_tenths ?? 0)) };
  }).bind(this);

  #view(
    hold: CreditHold,
    status: CreditMediaJobStatus,
    pollAfterSeconds: number,
    outputs: readonly CreditMediaOutput[],
  ): CreditMediaJob {
    const finished = status === "completed" || status === "failed" || status === "canceled";
    return {
      jobId: hold.jobId,
      model: hold.modelId,
      status,
      credits: hold.status === "released" ? 0 : (hold.charged ?? hold.credits),
      pollAfterSeconds: finished ? 0 : pollAfterSeconds,
      outputs,
      failure: hold.status === "released" ? failureOf(hold.outcome) : null,
    };
  }

  #releasedView(hold: CreditHold): CreditMediaJob {
    return this.#view(hold, hold.outcome === "canceled" ? "canceled" : "failed", 0, []);
  }

  #owned(payer: CreditMediaPayer, jobId: string): Effect.Effect<CreditHold, Failure> {
    return this.#spending
      .find(jobId)
      .pipe(Effect.flatMap((hold) => (hold && owns(payer, hold) ? Effect.succeed(hold) : Effect.fail(notFound()))));
  }

  #settle(hold: CreditHold, result: Parameters<CreditSpending["settle"]>[1]): Effect.Effect<CreditHold, Failure> {
    return this.#spending.settle(hold.jobId, result).pipe(Effect.map((settled) => settled ?? hold));
  }

  readonly submit = Effect.fn("CreditMedia.submit")(function* (
    this: CreditMediaService,
    payer: CreditMediaPayer,
    actorUserId: string | null,
    submission: CreditMediaSubmission,
  ): Effect.fn.Return<CreditMediaJob, Failure> {
    const upstream = yield* this.#upstreamOrFail();
    const { request } = submission;
    const stored = (yield* this.#models(request.model))[0];
    if (!stored)
      return yield* new BillingError(404, "media_model_unavailable", sourceText("error.billing.mediaModelUnavailable"));
    if (creditMediaRequestProblem(stored.model, request) || inputsProblem(stored.model, submission.inputs))
      return yield* invalidRequest();
    const credits = creditMediaCost(stored.model, request);
    if (credits === null) return yield* unavailable();
    const hold = yield* this.#spending.hold({
      jobId: request.jobId,
      wallet: walletOf(payer),
      actorUserId,
      modelId: stored.model.id,
      credits,
    });
    if (hold.status === "released") return this.#releasedView(hold);
    if (hold.status === "charged" || hold.providerJobId) return yield* this.job(payer, hold.jobId);
    yield* this.#spending.submitting(hold.jobId);
    const submitted = yield* Effect.result(
      upstream.submit(stored.model.kind, hold.jobId, upstreamBody(stored, submission)),
    );
    if (Result.isFailure(submitted)) {
      const error = submitted.failure;
      logUpstream("submit", error);
      if (REFUSED_STATUSES.has(error.status)) {
        yield* this.#settle(hold, { outcome: "refused" });
        return yield* new BillingError(400, "media_request_refused", sourceText("error.billing.mediaRequestRefused"));
      }
      if (NOT_ACCEPTED_STATUSES.has(error.status)) {
        yield* this.#settle(hold, { outcome: "refused" });
        return yield* error.status === 429 ? busy() : unavailable();
      }
      return yield* busy();
    }
    const job = submitted.success;
    const details = {
      resolution: request.resolution,
      duration: request.duration,
      count: request.count,
      audio: request.audio,
    };
    const started = (yield* this.#spending.start(hold.jobId, job.id, details)) ?? hold;
    return this.#view(started, job.status, job.pollAfterSeconds, []);
  }).bind(this);

  #artifacts(upstream: MediaUpstream, providerJobId: string): Effect.Effect<MediaUpstreamArtifact[], BillingError> {
    return upstream.result(providerJobId).pipe(
      Effect.mapError((error) => {
        logUpstream("result", error);
        return new BillingError(503, "media_result_unavailable", sourceText("error.billing.mediaResultUnavailable"));
      }),
    );
  }

  readonly job = Effect.fn("CreditMedia.job")(function* (
    this: CreditMediaService,
    payer: CreditMediaPayer,
    jobId: string,
  ): Effect.fn.Return<CreditMediaJob, Failure> {
    const hold = yield* this.#owned(payer, jobId);
    if (hold.status === "released") return this.#releasedView(hold);
    const upstream = yield* this.#upstreamOrFail();
    if (!hold.providerJobId) return this.#view(hold, "queued", QUEUED_POLL_SECONDS, []);
    if (hold.status === "charged") {
      const artifacts = yield* this.#artifacts(upstream, hold.providerJobId);
      return this.#view(hold, "completed", 0, outputsOf(artifacts));
    }
    const checked = yield* Effect.result(upstream.status(hold.providerJobId));
    if (Result.isFailure(checked)) {
      logUpstream("status", checked.failure);
      if (checked.failure.status === 404) return this.#releasedView(yield* this.#settle(hold, { outcome: "failed" }));
      return yield* busy();
    }
    const state = checked.success;
    if (state.status === "failed" || state.status === "canceled")
      return this.#releasedView(yield* this.#settle(hold, { outcome: state.status }));
    if (state.status !== "completed") return this.#view(hold, state.status, state.pollAfterSeconds, []);
    const artifacts = yield* this.#artifacts(upstream, hold.providerJobId);
    if (artifacts.length === 0) return this.#releasedView(yield* this.#settle(hold, { outcome: "failed" }));
    const charged = yield* this.#settle(hold, { outcome: "completed" });
    return this.#view(charged, "completed", 0, outputsOf(artifacts));
  }).bind(this);

  readonly output = Effect.fn("CreditMedia.output")(function* (
    this: CreditMediaService,
    payer: CreditMediaPayer,
    jobId: string,
    index: number,
  ): Effect.fn.Return<Response, Failure> {
    const hold = yield* this.#owned(payer, jobId);
    if (hold.status !== "charged" || !hold.providerJobId) return yield* notFound();
    const upstream = yield* this.#upstreamOrFail();
    const artifact = (yield* this.#artifacts(upstream, hold.providerJobId))[index];
    if (!artifact) return yield* notFound();
    const response = yield* upstream.download(artifact.url).pipe(
      Effect.mapError((error) => {
        logUpstream("download", error);
        return new BillingError(503, "media_result_unavailable", sourceText("error.billing.mediaResultUnavailable"));
      }),
    );
    const headers = new Headers({
      "Content-Type": artifact.mimeType,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "attachment",
    });
    const length = response.headers.get("Content-Length");
    if (length) headers.set("Content-Length", length);
    return new Response(response.body, { status: 200, headers });
  }).bind(this);

  checker(): CreditJobChecker | null {
    const upstream = this.#upstream;
    if (!upstream) return null;
    return (providerJobId) =>
      upstream.status(providerJobId).pipe(
        Effect.flatMap((state) => {
          if (state.status === "completed")
            return upstream
              .result(providerJobId)
              .pipe(
                Effect.map(
                  (artifacts): CreditJobCheck =>
                    artifacts.length > 0 ? { status: "completed" } : { status: "failed" },
                ),
              );
          if (state.status === "failed" || state.status === "canceled")
            return Effect.succeed<CreditJobCheck>({ status: state.status });
          return Effect.succeed<CreditJobCheck>({ status: "running" });
        }),
        Effect.catchIf(
          (error) => error.status === 404,
          () => Effect.succeed<CreditJobCheck>({ status: "failed" }),
        ),
        Effect.mapError(() => new BillingOperationError({})),
      );
  }

  readonly sweep = Effect.fn("CreditMedia.sweep")(function* (this: CreditMediaService) {
    return yield* this.#spending.sweep(this.checker());
  }).bind(this);
}
