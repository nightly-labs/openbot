import {
  CREDIT_MEDIA_FAILURE_REASONS,
  CREDIT_MEDIA_INPUT_LIMIT_BYTES,
  CREDIT_MEDIA_INPUT_TYPES,
  CREDIT_MEDIA_INPUTS_LIMIT_BYTES,
  CREDIT_MEDIA_KINDS,
  CREDIT_MEDIA_REQUEST_PART,
  type CreditMediaBalance,
  type CreditMediaCatalog,
  type CreditMediaFailure,
  type CreditMediaFailureReason,
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
import { type DynamicRecord, isDynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";
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
import { CreditGrants, welcomeTenthsSql } from "./credit-grants";
import {
  availableTenthsSql,
  type CreditHold,
  type CreditHoldInput,
  type CreditHoldOutcome,
  type CreditJobCheck,
  type CreditJobChecker,
  type CreditJobRelease,
  CreditSpending,
  type CreditSubmitTarget,
  type CreditWallet,
} from "./credit-spending";
import {
  LEGACY_MEDIA_UPSTREAM,
  type MediaFunding,
  type MediaGateway,
  type MediaGatewayArtifact,
  type MediaGatewayError,
  type MediaGatewayGeneration,
  type MediaGatewayInput,
  type MediaGatewayJob,
  type MediaGatewayModel,
} from "./media-gateway";

type Failure = BillingError | BillingOperationError;

const QUEUED_POLL_SECONDS = 5;
const REQUEST_BODY_LIMIT_BYTES = CREDIT_MEDIA_INPUTS_LIMIT_BYTES + 1024 * 1024;
const REFUSED_STATUSES = new Set([400, 404, 413, 415, 422]);
const NOT_ACCEPTED_STATUSES = new Set([401, 402, 403, 429]);

export type CreditMediaPayer = { wallet: "personal"; userId: string } | { wallet: "server"; serverId: string };

type CreditMediaInput = MediaGatewayInput;

export interface CreditMediaSubmission {
  request: CreditMediaJobRequest;
  inputs: readonly CreditMediaInput[];
}

export interface CreditMediaServiceOptions {
  database: D1Database;
  gateway: MediaGateway | null;
  now: () => number;
  analytics?: AccountAnalytics;
}

interface ModelRow {
  model_id: string;
  kind: string;
  name: string;
  maker: string;
  variant: string | null;
  specs: string;
  resolution: string;
  unit: string;
  credits: number;
  silent_credits: number | null;
}

interface StoredModel {
  model: CreditMediaModel;
  route: CreditSubmitTarget | null;
  welcome: CreditSubmitTarget | null;
}

function parseJsonRecord(text: string): DynamicRecord | null {
  try {
    const value = JSON.parse(text);
    return isDynamicRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function targetOf(modelId: string, upstream: string | null): CreditSubmitTarget | null {
  return upstream === null ? null : { upstream, model: modelId, params: "{}", fields: "{}" };
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

function storedModels(rows: readonly ModelRow[], routes: readonly MediaGatewayModel[]): StoredModel[] {
  const routed = new Map(routes.map((route) => [route.id, route]));
  const grouped = new Map<string, ModelRow[]>();
  for (const row of rows) grouped.set(row.model_id, [...(grouped.get(row.model_id) ?? []), row]);
  return [...grouped.values()].flatMap((group) => {
    const first = group[0];
    if (!first) return [];
    const route = routed.get(first.model_id) ?? null;
    const model = parseCreditMediaModel({
      ...parseJsonRecord(first.specs),
      ...route?.specs,
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
    if (!offered) return [];
    return [
      {
        model: offered,
        route: targetOf(first.model_id, route?.upstream ?? null),
        welcome: route ? targetOf(first.model_id, route.welcomeUpstream) : null,
      },
    ];
  });
}

function walletOf(payer: CreditMediaPayer): CreditWallet {
  return payer.wallet === "personal" ? { userId: payer.userId } : { serverId: payer.serverId };
}

type HoldRequest = Omit<CreditHoldInput, "wallet" | "welcome" | "viaServerId">;

function owns(payer: CreditMediaPayer, hold: CreditHold): boolean {
  if (payer.wallet === "personal")
    return hold.userId === payer.userId && hold.serverId === null && hold.viaServerId === null;
  return hold.viaServerId === payer.serverId || (hold.serverId === payer.serverId && hold.userId === null);
}

function notEnoughCredits(error: Failure): error is BillingError {
  return error instanceof BillingError && error.code === "credits_spend_not_enough";
}

function resumable(hold: CreditHold | null): boolean {
  return hold !== null && (hold.status !== "held" || hold.providerJobId !== null || hold.upstream !== null);
}

function failureOf(outcome: CreditHoldOutcome | null): CreditMediaFailure {
  if (outcome === "refused" || outcome === "canceled" || outcome === "expired") return outcome;
  return "failed";
}

const [CONTENT_POLICY_FAILURE] = CREDIT_MEDIA_FAILURE_REASONS;
const NOT_FOUND_REASON = "not_found";
const NO_OUTPUT_REASON = "no_output";

function releasedResult(state: MediaGatewayJob): CreditJobRelease {
  if (state.status === "canceled") return { outcome: "canceled" };
  const reason = state.failure ?? "unknown";
  return { outcome: reason === CONTENT_POLICY_FAILURE ? "refused" : "failed", reason };
}

function failureReasonOf(reason: string | null): CreditMediaFailureReason | null {
  return isOneOf(CREDIT_MEDIA_FAILURE_REASONS, reason) ? reason : null;
}

function outputsOf(artifacts: readonly MediaGatewayArtifact[]): CreditMediaOutput[] {
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
  upstream: string,
  funding: MediaFunding,
  submission: CreditMediaSubmission,
): MediaGatewayGeneration {
  const { request, inputs } = submission;
  return {
    jobId: request.jobId,
    model: stored.model.id,
    upstream,
    funding,
    kind: stored.model.kind,
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

function logUpstream(operation: string, error: MediaGatewayError, trace: CreditAuditTrace): void {
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
  readonly #gateway: MediaGateway | null;
  readonly #spending: CreditSpending;
  readonly #audit: CreditAudit;
  readonly #grants: CreditGrants;

  constructor(options: CreditMediaServiceOptions) {
    this.#database = options.database;
    this.#gateway = options.gateway;
    this.#spending = new CreditSpending({
      database: options.database,
      now: options.now,
      ...(options.analytics ? { analytics: options.analytics } : {}),
    });
    this.#audit = new CreditAudit(options.database, options.now);
    this.#grants = new CreditGrants({
      database: options.database,
      now: options.now,
      ...(options.analytics ? { analytics: options.analytics } : {}),
    });
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

  #models(
    gateway: MediaGateway,
    modelId: string | null,
    pinnedUpstream: string | null,
    trace: CreditAuditTrace,
    routesDown: "unrouted" | "busy",
  ): Effect.Effect<StoredModel[], Failure> {
    const rows = billingCall(() =>
      this.#database
        .prepare(
          `SELECT m.model_id, m.kind, m.name, m.maker, m.variant, m.specs,
                  p.resolution, p.unit, p.credits, p.silent_credits
             FROM credit_media_models m
             JOIN credit_media_prices p ON p.model_id = m.model_id
            WHERE m.enabled = 1 AND (?1 IS NULL OR m.model_id = ?1)
            ORDER BY m.kind, m.position, m.model_id, p.resolution`,
        )
        .bind(modelId)
        .all<ModelRow>(),
    );
    const routes = gateway.models(pinnedUpstream).pipe(
      Effect.catch((error) => {
        logUpstream("models", error, trace);
        return routesDown === "busy" ? Effect.fail(busy()) : Effect.succeed<MediaGatewayModel[]>([]);
      }),
    );
    return Effect.all([rows, routes], { concurrency: "unbounded" }).pipe(
      Effect.map(([result, routed]) => storedModels(result.results, routed)),
    );
  }

  #issueWelcome(payer: CreditMediaPayer): Effect.Effect<void> {
    if (payer.wallet !== "personal") return Effect.void;
    return this.#grants.welcome(payer.userId).pipe(
      Effect.asVoid,
      Effect.orElseSucceed(() => undefined),
    );
  }

  #serverOwner(serverId: string): Effect.Effect<string | null, Failure> {
    return billingCall(() =>
      this.#database
        .prepare("SELECT owner_user_id FROM remote_hosts WHERE host_id = ?1")
        .bind(serverId)
        .first<{ owner_user_id: string }>(),
    ).pipe(Effect.map((row) => row?.owner_user_id ?? null));
  }

  #gatewayOrFail(): Effect.Effect<MediaGateway, BillingError> {
    return this.#gateway ? Effect.succeed(this.#gateway) : Effect.fail(unavailable());
  }

  readonly catalog = Effect.fn("CreditMedia.catalog")(function* (
    this: CreditMediaService,
  ): Effect.fn.Return<CreditMediaCatalog, Failure> {
    if (!this.#gateway) return { models: [] };
    const stored = yield* this.#models(this.#gateway, null, null, creditAuditTrace(), "unrouted");
    const routed = (entry: StoredModel) => entry.route !== null;
    const byKind = (entries: readonly StoredModel[]) =>
      CREDIT_MEDIA_KINDS.flatMap((kind) => entries.filter((entry) => entry.model.kind === kind));
    const offered = (entry: StoredModel): CreditMediaModel =>
      entry.welcome ? { ...entry.model, welcome: true } : entry.model;
    return {
      models: byKind(stored.filter(routed)).map(offered),
      unavailable: byKind(stored.filter((entry) => !routed(entry))).map(({ model }) => ({
        id: model.id,
        kind: model.kind,
        name: model.name,
        variant: model.variant,
      })),
    };
  }).bind(this);

  readonly balance = Effect.fn("CreditMedia.balance")(function* (
    this: CreditMediaService,
    payer: CreditMediaPayer,
  ): Effect.fn.Return<CreditMediaBalance, Failure> {
    yield* this.#issueWelcome(payer);
    const column = payer.wallet === "personal" ? "user_id" : "server_id";
    const id = payer.wallet === "personal" ? payer.userId : payer.serverId;
    const owner = payer.wallet === "server" ? yield* this.#serverOwner(payer.serverId) : null;
    if (owner) yield* this.#issueWelcome({ wallet: "personal", userId: owner });
    const row = yield* billingCall(() =>
      this.#database
        .prepare(
          `SELECT ${availableTenthsSql(column, "?1")} AS available_tenths,
                  ${welcomeTenthsSql(column, "?1")} AS welcome_tenths,
                  ${welcomeTenthsSql("user_id", "?2")} AS owner_welcome_tenths`,
        )
        .bind(id, owner)
        .first<{ available_tenths: number; welcome_tenths: number; owner_welcome_tenths: number }>(),
    );
    const ownTenths = Math.max(0, row?.available_tenths ?? 0);
    const ownerWelcomeTenths = Math.max(0, row?.owner_welcome_tenths ?? 0);
    const availableTenths = ownTenths + ownerWelcomeTenths;
    const welcomeTenths = Math.min(ownTenths, Math.max(0, row?.welcome_tenths ?? 0)) + ownerWelcomeTenths;
    const balance: CreditMediaBalance = { wallet: payer.wallet, available: creditsFromTenths(availableTenths) };
    if (welcomeTenths > 0) balance.welcome = creditsFromTenths(welcomeTenths);
    return balance;
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
      reason: hold.status === "released" ? failureReasonOf(hold.failureReason) : null,
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
    const gateway = yield* this.#gatewayOrFail();
    const { request } = submission;
    const earlier = yield* this.#ownedHold(payer, request.jobId);
    const stored = (yield* this.#models(gateway, request.model, earlier?.upstream ?? null, trace, "busy"))[0];
    if (!stored) return yield* modelUnavailable();
    if (!stored.route && !resumable(earlier)) return yield* modelUnavailable();
    if (creditMediaRequestProblem(stored.model, request) || inputsProblem(stored.model, submission.inputs))
      return yield* invalidRequest();
    const credits = creditMediaCost(stored.model, request);
    if (credits === null) return yield* unavailable();
    quote.credits = credits;
    const hold = yield* this.#hold(
      payer,
      { jobId: request.jobId, actorUserId, modelId: stored.model.id, credits },
      stored.welcome !== null,
      earlier,
    );
    if (hold.status === "released") return this.#releasedView(hold);
    if (hold.status === "charged" || hold.providerJobId) return yield* this.#job(payer, hold.jobId, trace);
    const target = yield* this.#spending.claimSubmit(
      hold.jobId,
      hold.funding === "welcome" ? stored.welcome : stored.route,
    );
    if (!target) return yield* this.#job(payer, hold.jobId, trace);
    const submitted = yield* Effect.result(
      gateway.submit(generationOf(stored, target.upstream, hold.funding, submission)),
    );
    if (Result.isFailure(submitted)) {
      const error = submitted.failure;
      logUpstream("submit", error, trace);
      if (REFUSED_STATUSES.has(error.status)) {
        yield* this.#settle(hold, { outcome: "refused", reason: error.code });
        return yield* new BillingError(
          400,
          "media_request_refused",
          error.code === CONTENT_POLICY_FAILURE
            ? sourceText("error.billing.mediaContentRefused")
            : sourceText("error.billing.mediaRequestRefused"),
        );
      }
      if (NOT_ACCEPTED_STATUSES.has(error.status)) {
        yield* this.#settle(hold, { outcome: "refused", reason: error.code });
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
    const started = (yield* this.#spending.start(hold.jobId, job.id, details, job.upstream)) ?? hold;
    return this.#view(started, job.status, job.pollAfterSeconds, []);
  }).bind(this);

  readonly #hold = Effect.fn("CreditMedia.hold")(function* (
    this: CreditMediaService,
    payer: CreditMediaPayer,
    request: HoldRequest,
    welcome: boolean,
    earlier: CreditHold | null,
  ): Effect.fn.Return<CreditHold, Failure> {
    if (payer.wallet === "personal") {
      if (welcome) yield* this.#issueWelcome(payer);
      return yield* this.#spending.hold({ ...request, wallet: walletOf(payer), welcome });
    }
    if (earlier?.viaServerId === payer.serverId && earlier.userId !== null)
      return yield* this.#spending.hold({
        ...request,
        wallet: { userId: earlier.userId },
        welcome: true,
        viaServerId: payer.serverId,
      });
    const serverHold = this.#spending.hold({ ...request, wallet: walletOf(payer) });
    if (!welcome || earlier) return yield* serverHold;
    return yield* serverHold.pipe(
      Effect.catchIf(notEnoughCredits, (error) => this.#ownerWelcomeHold(payer.serverId, request, error)),
    );
  }).bind(this);

  readonly #ownerWelcomeHold = Effect.fn("CreditMedia.ownerWelcomeHold")(function* (
    this: CreditMediaService,
    serverId: string,
    request: HoldRequest,
    serverShort: BillingError,
  ): Effect.fn.Return<CreditHold, Failure> {
    const owner = yield* this.#serverOwner(serverId);
    if (!owner) return yield* serverShort;
    yield* this.#issueWelcome({ wallet: "personal", userId: owner });
    return yield* this.#spending.hold({ ...request, wallet: { userId: owner }, welcome: true, viaServerId: serverId });
  }).bind(this);

  #ownedHold(payer: CreditMediaPayer, jobId: string): Effect.Effect<CreditHold | null, Failure> {
    return this.#spending.find(jobId).pipe(Effect.map((hold) => (hold !== null && owns(payer, hold) ? hold : null)));
  }

  #artifacts(
    gateway: MediaGateway,
    upstream: string,
    providerJobId: string,
    trace: CreditAuditTrace,
  ): Effect.Effect<MediaGatewayArtifact[], BillingError> {
    return gateway.result(upstream, providerJobId).pipe(
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
    const gateway = yield* this.#gatewayOrFail();
    const upstream = hold.upstream ?? LEGACY_MEDIA_UPSTREAM;
    if (!hold.providerJobId) return this.#view(hold, "queued", QUEUED_POLL_SECONDS, []);
    if (hold.status === "charged") {
      const artifacts = yield* this.#artifacts(gateway, upstream, hold.providerJobId, trace);
      return this.#view(hold, "completed", 0, outputsOf(artifacts));
    }
    const checked = yield* Effect.result(gateway.status(upstream, hold.providerJobId));
    if (Result.isFailure(checked)) {
      logUpstream("status", checked.failure, trace);
      if (checked.failure.status === 404)
        return this.#releasedView(yield* this.#settle(hold, { outcome: "failed", reason: NOT_FOUND_REASON }));
      return yield* busy();
    }
    const state = checked.success;
    if (state.status === "failed" || state.status === "canceled")
      return this.#releasedView(yield* this.#settle(hold, releasedResult(state)));
    if (state.status !== "completed") return this.#view(hold, state.status, state.pollAfterSeconds, []);
    const artifacts = yield* this.#artifacts(gateway, upstream, hold.providerJobId, trace);
    if (artifacts.length === 0)
      return this.#releasedView(yield* this.#settle(hold, { outcome: "failed", reason: NO_OUTPUT_REASON }));
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
    const gateway = yield* this.#gatewayOrFail();
    const upstream = hold.upstream ?? LEGACY_MEDIA_UPSTREAM;
    const artifact = (yield* this.#artifacts(gateway, upstream, hold.providerJobId, trace))[index];
    if (!artifact) return yield* notFound();
    const response = yield* gateway.output(upstream, hold.providerJobId, index).pipe(
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
    const gateway = this.#gateway;
    if (!gateway) return null;
    return (providerJobId, jobId, name) => {
      const trace = creditAuditTrace();
      const upstream = name ?? LEGACY_MEDIA_UPSTREAM;
      return gateway.status(upstream, providerJobId).pipe(
        Effect.flatMap((state) => {
          if (state.status === "completed")
            return gateway
              .result(upstream, providerJobId)
              .pipe(
                Effect.map(
                  (artifacts): CreditJobCheck =>
                    artifacts.length > 0 ? { status: "completed" } : { status: "failed", reason: NO_OUTPUT_REASON },
                ),
              );
          if (state.status === "failed" || state.status === "canceled") {
            const { outcome, ...reason } = releasedResult(state);
            return Effect.succeed<CreditJobCheck>({ status: outcome, ...reason });
          }
          return Effect.succeed<CreditJobCheck>({ status: "running" });
        }),
        Effect.catchIf(
          (error) => error.status === 404,
          () => Effect.succeed<CreditJobCheck>({ status: "failed", reason: NOT_FOUND_REASON }),
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
