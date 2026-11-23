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
  CreditAudit,
  type CreditAuditEvent,
  type CreditAuditTrace,
  creditAuditCode,
  creditAuditTrace,
  upstreamDetail,
} from "./credit-audit";
import {
  availableTenthsSql,
  type CreditHold,
  type CreditHoldOutcome,
  type CreditJobCheck,
  type CreditJobChecker,
  CreditSpending,
  type CreditSubmitTarget,
  type CreditWallet,
} from "./credit-spending";
import {
  type MediaGeneration,
  type MediaGenerationInput,
  type MediaUpstream,
  type MediaUpstreamArtifact,
  type MediaUpstreamBody,
  type MediaUpstreamError,
  type MediaUpstreams,
  type MediaUpstreamValue,
  mediaUpstreamFields,
  ROUTER_MEDIA_UPSTREAM,
} from "./media-upstream";

type Failure = BillingError | BillingOperationError;

const QUEUED_POLL_SECONDS = 5;
const REQUEST_BODY_LIMIT_BYTES = CREDIT_MEDIA_INPUTS_LIMIT_BYTES + 1024 * 1024;
const REFUSED_STATUSES = new Set([400, 404, 413, 415, 422]);
const NOT_ACCEPTED_STATUSES = new Set([401, 402, 403, 429]);

export type CreditMediaPayer = { wallet: "personal"; userId: string } | { wallet: "server"; serverId: string };

type CreditMediaInput = MediaGenerationInput;

export interface CreditMediaSubmission {
  request: CreditMediaJobRequest;
  inputs: readonly CreditMediaInput[];
}

export interface CreditMediaServiceOptions {
  database: D1Database;
  upstreams: MediaUpstreams;
  now: () => number;
  analytics?: AccountAnalytics;
}

interface ModelRow {
  model_id: string;
  upstream: string | null;
  upstream_id: string | null;
  kind: string;
  name: string;
  maker: string;
  variant: string | null;
  specs: string;
  upstream_params: string | null;
  upstream_fields: string | null;
  route_specs: string | null;
  resolution: string;
  unit: string;
  credits: number;
  silent_credits: number | null;
}

interface StoredModel {
  model: CreditMediaModel;
  route: CreditSubmitTarget | null;
}

function parseJsonRecord(text: string): DynamicRecord | null {
  try {
    const value = JSON.parse(text);
    return isDynamicRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function routeOf(row: ModelRow): CreditSubmitTarget | null {
  if (row.upstream === null || row.upstream_id === null) return null;
  return {
    upstream: row.upstream,
    model: row.upstream_id,
    params: JSON.stringify(upstreamParams(row.upstream_params ?? "{}")),
    fields: row.upstream_fields ?? "{}",
  };
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

function withOfferedPrices(model: CreditMediaModel): CreditMediaModel | null {
  if (model.resolutions.length === 0) return model;
  if (model.defaultResolution !== null && !model.resolutions.includes(model.defaultResolution)) return null;
  const prices = model.prices.filter(
    (price) => price.resolution === null || model.resolutions.includes(price.resolution),
  );
  const priced = (resolution: string) =>
    prices.some((price) => price.resolution === null || price.resolution === resolution);
  if (!model.resolutions.every(priced)) return null;
  return prices.length > 0 ? { ...model, prices } : model;
}

function storedModels(rows: readonly ModelRow[]): StoredModel[] {
  const grouped = new Map<string, ModelRow[]>();
  for (const row of rows) grouped.set(row.model_id, [...(grouped.get(row.model_id) ?? []), row]);
  return [...grouped.values()].flatMap((group) => {
    const first = group[0];
    if (!first) return [];
    const model = parseCreditMediaModel({
      ...parseJsonRecord(first.specs),
      ...parseJsonRecord(first.route_specs ?? "{}"),
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
    const offered = model ? withOfferedPrices(model) : null;
    return offered ? [{ model: offered, route: routeOf(first) }] : [];
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

function generationOf(
  stored: StoredModel,
  target: CreditSubmitTarget,
  submission: CreditMediaSubmission,
): MediaGeneration {
  const { request, inputs } = submission;
  return {
    kind: stored.model.kind,
    model: target.model,
    params: upstreamParams(target.params),
    fields: mediaUpstreamFields(parseJsonRecord(target.fields)),
    prompt: request.prompt,
    aspect: request.aspect ?? stored.model.defaultAspect,
    resolution: request.resolution ?? stored.model.defaultResolution,
    count: request.count,
    duration: stored.model.kind === "video" ? (request.duration ?? stored.model.defaultDuration) : null,
    audio: stored.model.audio ? request.audio : null,
    inputs,
  };
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

function modelUnavailable(): BillingError {
  return new BillingError(404, "media_model_unavailable", sourceText("error.billing.mediaModelUnavailable"));
}

function notFound(): BillingError {
  return new BillingError(404, "media_job_not_found", sourceText("error.billing.mediaJobNotFound"));
}

function logUpstream(operation: string, error: MediaUpstreamError, trace: CreditAuditTrace): void {
  console.error("media: upstream request failed", { operation, status: error.status, code: error.code });
  trace.upstream = { operation, status: error.status, code: error.code };
}

function payerWallet(payer: CreditMediaPayer) {
  return payer.wallet === "personal"
    ? { userId: payer.userId, serverId: null }
    : { userId: null, serverId: payer.serverId };
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
  readonly #upstreams: MediaUpstreams;
  readonly #spending: CreditSpending;
  readonly #audit: CreditAudit;

  constructor(options: CreditMediaServiceOptions) {
    this.#database = options.database;
    this.#upstreams = options.upstreams;
    this.#spending = new CreditSpending({
      database: options.database,
      now: options.now,
      ...(options.analytics ? { analytics: options.analytics } : {}),
    });
    this.#audit = new CreditAudit(options.database, options.now);
  }

  #audited<A>(
    event: CreditAuditEvent,
    payer: CreditMediaPayer,
    run: (trace: CreditAuditTrace) => Effect.Effect<A, Failure>,
    entry: { actorUserId?: string | null; modelId?: string; reference?: string; credits?: () => number | undefined },
  ): Effect.Effect<A, Failure> {
    const trace = creditAuditTrace();
    return run(trace).pipe(
      Effect.tapError((error) => {
        const credits = entry.credits?.();
        return this.#audit.failed({
          event,
          code: creditAuditCode(error),
          wallet: payerWallet(payer),
          ...(entry.actorUserId === undefined ? {} : { actorUserId: entry.actorUserId }),
          ...(entry.modelId === undefined ? {} : { modelId: entry.modelId }),
          ...(entry.reference === undefined ? {} : { reference: entry.reference }),
          ...(credits === undefined ? {} : { credits }),
          detail: upstreamDetail(trace),
        });
      }),
    );
  }

  #models(modelId: string | null): Effect.Effect<StoredModel[], Failure> {
    return billingCall(() =>
      this.#database
        .prepare(
          `SELECT m.model_id, r.upstream, r.upstream_id, m.kind, m.name, m.maker, m.variant, m.specs,
                  r.upstream_params, r.upstream_fields, r.specs AS route_specs, p.resolution, p.unit, p.credits, p.silent_credits
             FROM credit_media_models m
             JOIN credit_media_prices p ON p.model_id = m.model_id
             LEFT JOIN credit_media_routes r ON r.model_id = m.model_id
              AND r.upstream = COALESCE((SELECT upstream FROM credit_media_settings WHERE id = 1), ?2)
            WHERE m.enabled = 1 AND (?1 IS NULL OR m.model_id = ?1)
            ORDER BY m.kind, m.position, m.model_id, p.resolution`,
        )
        .bind(modelId, ROUTER_MEDIA_UPSTREAM)
        .all<ModelRow>(),
    ).pipe(Effect.map((result) => storedModels(result.results)));
  }

  #upstreamOrFail(name: string | null): Effect.Effect<MediaUpstream, BillingError> {
    const upstream = this.#upstreams.get(name ?? ROUTER_MEDIA_UPSTREAM);
    return upstream ? Effect.succeed(upstream) : Effect.fail(unavailable());
  }

  readonly catalog = Effect.fn("CreditMedia.catalog")(function* (
    this: CreditMediaService,
  ): Effect.fn.Return<CreditMediaCatalog, Failure> {
    if (this.#upstreams.size === 0) return { models: [] };
    const models = (yield* this.#models(null)).filter(
      (stored) => stored.route !== null && this.#upstreams.has(stored.route.upstream),
    );
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

  submit(
    payer: CreditMediaPayer,
    actorUserId: string | null,
    submission: CreditMediaSubmission,
  ): Effect.Effect<CreditMediaJob, Failure> {
    const quote: { credits?: number } = {};
    return this.#audited("media_submit", payer, (trace) => this.#submit(payer, actorUserId, submission, trace, quote), {
      actorUserId,
      modelId: submission.request.model,
      reference: submission.request.jobId,
      credits: () => quote.credits,
    });
  }

  readonly #submit = Effect.fn("CreditMedia.submit")(function* (
    this: CreditMediaService,
    payer: CreditMediaPayer,
    actorUserId: string | null,
    submission: CreditMediaSubmission,
    trace: CreditAuditTrace,
    quote: { credits?: number },
  ): Effect.fn.Return<CreditMediaJob, Failure> {
    if (this.#upstreams.size === 0) return yield* unavailable();
    const { request } = submission;
    const stored = (yield* this.#models(request.model))[0];
    if (!stored) return yield* modelUnavailable();
    if (stored.route) yield* this.#upstreamOrFail(stored.route.upstream);
    else if (!(yield* this.#resumable(payer, request.jobId))) return yield* modelUnavailable();
    if (creditMediaRequestProblem(stored.model, request) || inputsProblem(stored.model, submission.inputs))
      return yield* invalidRequest();
    const credits = creditMediaCost(stored.model, request);
    if (credits === null) return yield* unavailable();
    quote.credits = credits;
    const hold = yield* this.#spending.hold({
      jobId: request.jobId,
      wallet: walletOf(payer),
      actorUserId,
      modelId: stored.model.id,
      credits,
    });
    if (hold.status === "released") return this.#releasedView(hold);
    if (hold.status === "charged" || hold.providerJobId) return yield* this.#job(payer, hold.jobId, trace);
    const target = yield* this.#spending.claimSubmit(hold.jobId, stored.route);
    if (!target) return yield* this.#job(payer, hold.jobId, trace);
    const upstream = this.#upstreams.get(target.upstream);
    if (!upstream) {
      yield* this.#spending.endSubmit(hold.jobId);
      return yield* unavailable();
    }
    const submitted = yield* Effect.result(upstream.submit(hold.jobId, generationOf(stored, target, submission)));
    if (Result.isFailure(submitted)) {
      const error = submitted.failure;
      logUpstream("submit", error, trace);
      if (REFUSED_STATUSES.has(error.status)) {
        yield* this.#settle(hold, { outcome: "refused" });
        return yield* new BillingError(400, "media_request_refused", sourceText("error.billing.mediaRequestRefused"));
      }
      if (NOT_ACCEPTED_STATUSES.has(error.status)) {
        yield* this.#settle(hold, { outcome: "refused" });
        return yield* error.status === 429 ? busy() : unavailable();
      }
      yield* this.#spending.endSubmit(hold.jobId);
      return yield* busy();
    }
    const job = submitted.success;
    const details = {
      resolution: request.resolution,
      duration: request.duration,
      count: request.count,
      audio: request.audio,
    };
    const started = (yield* this.#spending.start(hold.jobId, job.id, details, target.upstream)) ?? hold;
    return this.#view(started, job.status, job.pollAfterSeconds, []);
  }).bind(this);

  #resumable(payer: CreditMediaPayer, jobId: string): Effect.Effect<boolean, Failure> {
    return this.#spending
      .find(jobId)
      .pipe(
        Effect.map(
          (hold) =>
            hold !== null &&
            owns(payer, hold) &&
            (hold.status !== "held" || hold.providerJobId !== null || hold.upstream !== null),
        ),
      );
  }

  #artifacts(
    upstream: MediaUpstream,
    providerJobId: string,
    trace: CreditAuditTrace,
  ): Effect.Effect<MediaUpstreamArtifact[], BillingError> {
    return upstream.result(providerJobId).pipe(
      Effect.mapError((error) => {
        logUpstream("result", error, trace);
        return new BillingError(503, "media_result_unavailable", sourceText("error.billing.mediaResultUnavailable"));
      }),
    );
  }

  job(payer: CreditMediaPayer, jobId: string): Effect.Effect<CreditMediaJob, Failure> {
    return this.#audited("media_job", payer, (trace) => this.#job(payer, jobId, trace), { reference: jobId });
  }

  readonly #job = Effect.fn("CreditMedia.job")(function* (
    this: CreditMediaService,
    payer: CreditMediaPayer,
    jobId: string,
    trace: CreditAuditTrace,
  ): Effect.fn.Return<CreditMediaJob, Failure> {
    const hold = yield* this.#owned(payer, jobId);
    if (hold.status === "released") return this.#releasedView(hold);
    const upstream = yield* this.#upstreamOrFail(hold.upstream);
    if (!hold.providerJobId) return this.#view(hold, "queued", QUEUED_POLL_SECONDS, []);
    if (hold.status === "charged") {
      const artifacts = yield* this.#artifacts(upstream, hold.providerJobId, trace);
      return this.#view(hold, "completed", 0, outputsOf(artifacts));
    }
    const checked = yield* Effect.result(upstream.status(hold.providerJobId));
    if (Result.isFailure(checked)) {
      logUpstream("status", checked.failure, trace);
      if (checked.failure.status === 404) return this.#releasedView(yield* this.#settle(hold, { outcome: "failed" }));
      return yield* busy();
    }
    const state = checked.success;
    if (state.status === "failed" || state.status === "canceled")
      return this.#releasedView(yield* this.#settle(hold, { outcome: state.status }));
    if (state.status !== "completed") return this.#view(hold, state.status, state.pollAfterSeconds, []);
    const artifacts = yield* this.#artifacts(upstream, hold.providerJobId, trace);
    if (artifacts.length === 0) return this.#releasedView(yield* this.#settle(hold, { outcome: "failed" }));
    const charged = yield* this.#settle(hold, { outcome: "completed" });
    return this.#view(charged, "completed", 0, outputsOf(artifacts));
  }).bind(this);

  output(payer: CreditMediaPayer, jobId: string, index: number): Effect.Effect<Response, Failure> {
    return this.#audited("media_output", payer, (trace) => this.#output(payer, jobId, index, trace), {
      reference: jobId,
    });
  }

  readonly #output = Effect.fn("CreditMedia.output")(function* (
    this: CreditMediaService,
    payer: CreditMediaPayer,
    jobId: string,
    index: number,
    trace: CreditAuditTrace,
  ): Effect.fn.Return<Response, Failure> {
    const hold = yield* this.#owned(payer, jobId);
    if (hold.status !== "charged" || !hold.providerJobId) return yield* notFound();
    const upstream = yield* this.#upstreamOrFail(hold.upstream);
    const artifact = (yield* this.#artifacts(upstream, hold.providerJobId, trace))[index];
    if (!artifact) return yield* notFound();
    const response = yield* upstream.download(artifact.url).pipe(
      Effect.mapError((error) => {
        logUpstream("download", error, trace);
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
    if (this.#upstreams.size === 0) return null;
    return (providerJobId, jobId, name) => {
      const trace = creditAuditTrace();
      const upstream = this.#upstreams.get(name ?? ROUTER_MEDIA_UPSTREAM);
      if (!upstream) {
        console.error("media: upstream not configured", { upstream: name });
        return Effect.fail(new BillingOperationError({}));
      }
      return upstream.status(providerJobId).pipe(
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
        Effect.tapError((error) =>
          Effect.sync(() => logUpstream("check", error, trace)).pipe(
            Effect.andThen(this.#audit.failedHold("media_check", jobId, "check_failed", trace)),
          ),
        ),
        Effect.mapError(() => new BillingOperationError({})),
      );
    };
  }

  readonly sweep = Effect.fn("CreditMedia.sweep")(function* (this: CreditMediaService) {
    return yield* this.#spending.sweep(this.checker());
  }).bind(this);
}
