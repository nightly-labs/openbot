import { readFile } from "node:fs/promises";
import {
  CREDIT_MEDIA_INPUT_LIMIT_BYTES,
  CREDIT_MEDIA_INPUT_TYPES,
  CREDIT_MEDIA_INPUTS_LIMIT_BYTES,
  CREDIT_MEDIA_PROMPT_LIMIT,
  type CreditMediaBalance,
  type CreditMediaCatalog,
  type CreditMediaInputRole,
  type CreditMediaJob,
  type CreditMediaJobRequest,
  type CreditMediaModel,
  type CreditMediaUnavailableModel,
  creditMediaCost,
  creditMediaRequiredInput,
} from "@openbot/contracts/credit-media";
import {
  WORKFLOW_CREDIT_MODEL_PREFIX,
  WORKFLOW_MEDIA_ASPECTS,
  WORKFLOW_MEDIA_SWITCH_VALUES,
  type WorkflowMediaAspect,
  type WorkflowMediaCatalog,
  type WorkflowMediaCatalogModel,
  type WorkflowMediaCreditBalance,
  type WorkflowMediaInput,
  type WorkflowMediaKind,
  type WorkflowMediaPriceRequest,
  type WorkflowMediaSpecs,
} from "@openbot/contracts/ipc";
import { isOneOf } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Duration, Effect, Schema, Semaphore } from "effect";
import { type McpMediaDependencies, type McpMediaFailed, mediaFail, mediaFailed } from "./mcp-media";
import type { MediaPictureRole } from "./workflow-walk";

const CATALOG_TTL_MS = 10 * 60_000;
const FAILED_TTL_MS = 60_000;
const POLL_MIN_SECONDS = 2;
const POLL_MAX_SECONDS = 30;
const SIGN_IN_CHECKS = 30;
const NAME_MAX = 160;
const AUDIO_OPTION = "audio";
const CREDIT_JOB_CONFLICT = "credits_job_conflict";
const RETRY_CODES: ReadonlySet<string> = new Set(["media_busy", "media_result_unavailable"]);
const RETRY_STATUSES: ReadonlySet<number> = new Set([0, 500, 502, 504]);
const RETRY_LIMIT_MS = 10 * 60_000;
const RESUBMIT_AFTER_MS = 200_000;

export class CreditMediaGatewayFailed extends Schema.TaggedError<CreditMediaGatewayFailed>()(
  "CreditMediaGatewayFailed",
  { message: Schema.String, status: Schema.Number, code: Schema.String },
) {}

export interface CreditMediaUpload {
  role: CreditMediaInputRole;
  bytes: Uint8Array;
  mimeType: string;
}

export interface CreditMediaGateway {
  available: () => boolean;
  catalog: () => Effect.Effect<CreditMediaCatalog, CreditMediaGatewayFailed>;
  balance: () => Effect.Effect<CreditMediaBalance, CreditMediaGatewayFailed>;
  submit: (
    request: CreditMediaJobRequest,
    inputs: readonly CreditMediaUpload[],
  ) => Effect.Effect<CreditMediaJob, CreditMediaGatewayFailed>;
  job: (jobId: string) => Effect.Effect<CreditMediaJob, CreditMediaGatewayFailed>;
  output: (jobId: string, index: number) => Effect.Effect<Uint8Array, CreditMediaGatewayFailed>;
}

export interface CreditMediaRequest {
  jobId: string;
  earlierJobIds: readonly string[];
  kind: WorkflowMediaKind;
  model: string;
  prompt: string;
  specs: WorkflowMediaSpecs;
  images: readonly { role: MediaPictureRole; attachmentId: string }[];
}

export interface CreditMediaWorkflowsOptions {
  gateway: CreditMediaGateway;
  warn: (message: string, details: { error: string }) => void;
  now?: () => number;
  creditsChanged?: () => void;
}

interface CreditMediaInput {
  mimeType: string;
  bytes: Effect.Effect<Uint8Array, McpMediaFailed>;
}

export type CreditMediaInputRead = (attachmentId: string) => Effect.Effect<CreditMediaInput | null, McpMediaFailed>;

interface CreditMediaMade {
  bytes: Uint8Array;
  mimeType: string;
  credits: number;
}

export interface CreditMediaAgentRequest {
  jobId: string;
  model: CreditMediaModel;
  job: Omit<CreditMediaJobRequest, "jobId">;
  images: readonly { role: CreditMediaInputRole; attachmentId: string }[];
}

interface Listed {
  at: number;
  models: ReadonlyMap<string, CreditMediaModel> | null;
  unavailable: readonly CreditMediaUnavailableModel[];
}

const NOTHING_LISTED: Omit<Listed, "at"> = { models: null, unavailable: [] };

export const creditWorkflowModelId = (model: string) => `${WORKFLOW_CREDIT_MODEL_PREFIX}${model}`;

function defaultFirst<T>(values: readonly T[], preferred: unknown): T[] {
  const first = values.find((value) => value === preferred);
  return first === undefined ? [...values] : [first, ...values.filter((value) => value !== first)];
}

function workflowAspects(model: CreditMediaModel): WorkflowMediaAspect[] {
  const aspects = model.aspects.filter((aspect): aspect is WorkflowMediaAspect =>
    isOneOf(WORKFLOW_MEDIA_ASPECTS, aspect),
  );
  return aspects.length > 0 ? defaultFirst(aspects, model.defaultAspect) : ["1:1"];
}

function workflowInputs(model: CreditMediaModel): WorkflowMediaInput[] {
  return [...(model.frames > 0 ? ["frames" as const] : []), ...(model.references > 0 ? ["references" as const] : [])];
}

const creditWorkflowModelName = (model: { name: string; variant: string | null }) =>
  (model.variant ? `${model.name} · ${model.variant}` : model.name).slice(0, NAME_MAX);

export function creditWorkflowModel(model: CreditMediaModel): WorkflowMediaCatalogModel {
  const inputs = workflowInputs(model);
  const durations = model.kind === "video" ? model.durations.filter((value) => Number.isSafeInteger(value)) : [];
  const defaultDuration = durations.find((value) => value === model.defaultDuration);
  return {
    id: creditWorkflowModelId(model.id),
    provider: "openbot",
    providerModel: model.id,
    name: creditWorkflowModelName(model),
    maker: model.maker,
    kinds: [model.kind],
    aspects: workflowAspects(model),
    durations,
    ...(defaultDuration === undefined ? {} : { defaultDuration }),
    resolutions: defaultFirst(model.resolutions, model.defaultResolution),
    transparent: false,
    ...(model.audio
      ? {
          options: [
            { name: AUDIO_OPTION, kind: "switch" as const, values: WORKFLOW_MEDIA_SWITCH_VALUES, default: "on" },
          ],
        }
      : {}),
    inputs,
    ...(model.kind === "video" && model.frames > 0 ? { frameCount: model.frames } : {}),
  };
}

function chosen<T>(values: readonly T[], value: T, fallback: T | null): T | null {
  if (values.includes(value)) return value;
  return fallback !== null && values.includes(fallback) ? fallback : (values[0] ?? null);
}

function creditJobRequest(
  model: CreditMediaModel,
  request: Pick<CreditMediaRequest, "prompt" | "specs">,
  jobId: string,
): CreditMediaJobRequest {
  const { specs } = request;
  const audio = specs.options.find((option) => option.name === AUDIO_OPTION)?.value ?? "on";
  return {
    jobId,
    model: model.id,
    prompt: request.prompt.slice(0, CREDIT_MEDIA_PROMPT_LIMIT),
    aspect: chosen(model.aspects, specs.aspect, model.defaultAspect),
    resolution:
      specs.resolution === null
        ? model.defaultResolution
        : chosen(model.resolutions, specs.resolution, model.defaultResolution),
    duration: model.kind === "video" ? chosen(model.durations, specs.duration, model.defaultDuration) : null,
    count: 1,
    audio: model.audio && audio === "on",
  };
}

interface UploadPick {
  attachmentId: string;
  role: CreditMediaInputRole;
}

function creditUploadPicks(
  model: CreditMediaModel,
  images: readonly { role: MediaPictureRole; attachmentId: string }[],
): UploadPick[] {
  const ofRole = (role: MediaPictureRole) =>
    images.filter((image) => image.role === role).map((image) => image.attachmentId);
  const frames = model.kind === "video" ? model.frames : 0;
  const spare = model.references === 0 ? [...new Set(ofRole("reference"))] : [];
  const first = frames > 0 ? (ofRole("first")[0] ?? spare.shift()) : undefined;
  const last = frames > 1 && first !== undefined ? (ofRole("last")[0] ?? spare.shift()) : undefined;
  const loose = frames === 0 ? [...ofRole("first"), ...ofRole("last")] : [];
  const references = [...new Set([...ofRole("reference"), ...loose])].slice(0, model.references);
  return [
    ...(first === undefined ? [] : [{ attachmentId: first, role: "first" as const }]),
    ...(last === undefined ? [] : [{ attachmentId: last, role: "last" as const }]),
    ...references.map((attachmentId) => ({ attachmentId, role: "reference" as const })),
  ];
}

const failedOf = (failure: CreditMediaGatewayFailed) => mediaFail(failure.message);

const transient = (failure: CreditMediaGatewayFailed) =>
  RETRY_STATUSES.has(failure.status) || RETRY_CODES.has(failure.code);

function workflowAttachmentRead(resolveAttachment: McpMediaDependencies["resolveAttachment"]): CreditMediaInputRead {
  return (attachmentId) =>
    resolveAttachment(attachmentId).pipe(
      Effect.mapError(() => mediaFail(sourceText("error.workflow.mediaInputMissing"))),
      Effect.map((file) =>
        file
          ? {
              mimeType: file.mimeType,
              bytes: Effect.tryPromise({
                try: async () => new Uint8Array(await readFile(file.path)),
                catch: () => mediaFail(sourceText("error.workflow.mediaInputMissing")),
              }),
            }
          : null,
      ),
    );
}

export class CreditMediaWorkflows {
  readonly #options: CreditMediaWorkflowsOptions;
  readonly #lock = Semaphore.makeUnsafe(1);
  #listed: Listed | null = null;

  constructor(options: CreditMediaWorkflowsOptions) {
    this.#options = options;
  }

  #now(): number {
    return this.#options.now?.() ?? Date.now();
  }

  #fresh(): Listed | null {
    const listed = this.#listed;
    if (!listed) return null;
    return this.#now() - listed.at < (listed.models ? CATALOG_TTL_MS : FAILED_TTL_MS) ? listed : null;
  }

  available(): boolean {
    return this.#options.gateway.available();
  }

  #list(): Effect.Effect<Omit<Listed, "at">> {
    return Effect.suspend(() => {
      if (!this.available()) return Effect.succeed(NOTHING_LISTED);
      const kept = this.#fresh();
      if (kept) return Effect.succeed(kept);
      return this.#lock.withPermit(
        Effect.suspend(() => {
          const again = this.#fresh();
          if (again) return Effect.succeed(again);
          return this.#options.gateway.catalog().pipe(
            Effect.map(
              (catalog): Omit<Listed, "at"> => ({
                models: catalog.models.length > 0 ? new Map(catalog.models.map((model) => [model.id, model])) : null,
                unavailable: catalog.unavailable ?? [],
              }),
            ),
            Effect.catch((failure) =>
              Effect.sync(() => {
                this.#options.warn("Could not read the credit media models.", { error: failure.message });
                return NOTHING_LISTED;
              }),
            ),
            Effect.tap((listed) =>
              Effect.sync(() => {
                this.#listed = { at: this.#now(), ...listed };
              }),
            ),
          );
        }),
      );
    });
  }

  #models(): Effect.Effect<ReadonlyMap<string, CreditMediaModel> | null> {
    return this.#list().pipe(Effect.map((listed) => listed.models));
  }

  #model(id: string) {
    return this.#models().pipe(
      Effect.map((models) =>
        id.startsWith(WORKFLOW_CREDIT_MODEL_PREFIX)
          ? (models?.get(id.slice(WORKFLOW_CREDIT_MODEL_PREFIX.length)) ?? null)
          : null,
      ),
    );
  }

  readonly catalog = Effect.fn("CreditMediaWorkflows.catalog")(function* (this: CreditMediaWorkflows) {
    const { models, unavailable } = yield* this.#list();
    return {
      models: models ? [...models.values()].map(creditWorkflowModel) : [],
      unavailable: unavailable.map((model) => ({
        id: creditWorkflowModelId(model.id),
        name: creditWorkflowModelName(model),
        kinds: [model.kind],
      })),
    } satisfies WorkflowMediaCatalog;
  }).bind(this);

  readonly price = Effect.fn("CreditMediaWorkflows.price")(function* (
    this: CreditMediaWorkflows,
    request: WorkflowMediaPriceRequest,
  ) {
    const model = yield* this.#model(request.model);
    if (!model || model.kind !== request.kind) return null;
    const job = creditJobRequest(
      model,
      {
        prompt: "",
        specs: {
          aspect: request.aspect,
          duration: request.duration,
          resolution: request.resolution,
          transparent: false,
          size: null,
          options: request.options ?? [],
        },
      },
      "",
    );
    return creditMediaCost(model, { resolution: job.resolution, duration: job.duration, count: 1, audio: job.audio });
  }).bind(this);

  readonly credits = Effect.fn("CreditMediaWorkflows.credits")(function* (this: CreditMediaWorkflows) {
    const balance = yield* this.balance();
    if (!balance) return null;
    return { available: Math.max(0, balance.available), quota: null } satisfies WorkflowMediaCreditBalance;
  }).bind(this);

  readonly balance = Effect.fn("CreditMediaWorkflows.balance")(function* (
    this: CreditMediaWorkflows,
  ): Effect.fn.Return<CreditMediaBalance | null> {
    if (!this.available()) return null;
    return yield* this.#options.gateway.balance().pipe(
      Effect.catch((failure) =>
        Effect.sync(() => {
          this.#options.warn("Could not read the media credits.", { error: failure.message });
          return null;
        }),
      ),
    );
  }).bind(this);

  #uploads = Effect.fn("CreditMediaWorkflows.uploads")(function* (
    this: CreditMediaWorkflows,
    read: CreditMediaInputRead,
    model: CreditMediaModel,
    images: readonly { role: MediaPictureRole; attachmentId: string }[],
  ) {
    const picks = creditUploadPicks(model, images);
    const required = creditMediaRequiredInput(model);
    if (required !== null && !picks.some((pick) => pick.role === required))
      return yield* mediaFail(sourceText("error.workflow.creditMediaPictureRequired"));
    const uploads: CreditMediaUpload[] = [];
    let total = 0;
    for (const { attachmentId, role } of picks) {
      const file = yield* read(attachmentId);
      if (!file) return yield* mediaFail(sourceText("error.workflow.mediaInputMissing"));
      const mimeType = file.mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
      if (!mimeType.startsWith("image/")) return yield* mediaFail(sourceText("error.workflow.mediaInputNotImage"));
      if (!isOneOf(CREDIT_MEDIA_INPUT_TYPES, mimeType))
        return yield* mediaFail(sourceText("error.workflow.mediaInputType"));
      const bytes = yield* file.bytes;
      total += bytes.byteLength;
      if (bytes.byteLength > CREDIT_MEDIA_INPUT_LIMIT_BYTES || total > CREDIT_MEDIA_INPUTS_LIMIT_BYTES)
        return yield* mediaFail(sourceText("error.workflow.mediaInputTooLarge"));
      uploads.push({ role, bytes, mimeType });
    }
    return uploads;
  });

  #signedIn = Effect.fn("CreditMediaWorkflows.signedIn")(function* (this: CreditMediaWorkflows) {
    for (let check = 1; check < SIGN_IN_CHECKS && !this.available(); check += 1)
      yield* Effect.sleep(Duration.seconds(POLL_MIN_SECONDS));
    return this.available();
  });

  #again<A>(
    attempt: Effect.Effect<A, CreditMediaGatewayFailed>,
    patient: boolean,
  ): Effect.Effect<A, CreditMediaGatewayFailed> {
    if (!patient) return attempt;
    const until = this.#now() + RETRY_LIMIT_MS;
    const next: Effect.Effect<A, CreditMediaGatewayFailed> = attempt.pipe(
      Effect.catchIf(
        (failure) => transient(failure) && this.#now() < until,
        () => Effect.sleep(Duration.seconds(POLL_MAX_SECONDS)).pipe(Effect.andThen(Effect.suspend(() => next))),
      ),
    );
    return next;
  }

  #existing(jobId: string, patient = false) {
    return this.#again(this.#options.gateway.job(jobId), patient).pipe(
      Effect.map((job): CreditMediaJob | null => job),
      Effect.catchIf(
        (failure) => failure.status === 404,
        () => Effect.succeed(null),
      ),
      Effect.mapError(failedOf),
    );
  }

  #earlier = Effect.fn("CreditMediaWorkflows.earlier")(function* (
    this: CreditMediaWorkflows,
    jobIds: readonly string[],
  ) {
    for (const jobId of jobIds) {
      const found = yield* this.#existing(jobId);
      if (found !== null) return found.status === "failed" || found.status === "canceled" ? null : found;
    }
    return null;
  });

  #submitJob = Effect.fn("CreditMediaWorkflows.submitJob")(function* (
    this: CreditMediaWorkflows,
    read: CreditMediaInputRead,
    model: CreditMediaModel,
    job: CreditMediaJobRequest,
    images: readonly { role: MediaPictureRole; attachmentId: string }[],
    patient = false,
  ) {
    if (model.promptRequired && job.prompt.trim() === "")
      return yield* mediaFail(sourceText("error.workflow.creditMediaPromptRequired"));
    const uploads = yield* this.#uploads(read, model, images);
    const gateway = this.#options.gateway;
    return yield* this.#again(gateway.submit(job, uploads), patient).pipe(
      Effect.catchIf(
        (failure) => failure.code === CREDIT_JOB_CONFLICT,
        () => this.#again(gateway.job(job.jobId), patient),
      ),
      Effect.mapError(failedOf),
    );
  });

  #submit = Effect.fn("CreditMediaWorkflows.submit")(function* (
    this: CreditMediaWorkflows,
    read: CreditMediaInputRead,
    request: CreditMediaRequest,
  ) {
    const model = yield* this.#model(request.model);
    if (!model || model.kind !== request.kind)
      return yield* mediaFail(sourceText("error.billing.mediaModelUnavailable"));
    return yield* this.#submitJob(read, model, creditJobRequest(model, request, request.jobId), request.images);
  });

  #wait = Effect.fn("CreditMediaWorkflows.wait")(function* (
    this: CreditMediaWorkflows,
    started: CreditMediaJob,
    start: (jobId: string) => Effect.Effect<CreditMediaJob, McpMediaFailed>,
    patient: boolean,
  ) {
    const gateway = this.#options.gateway;
    let job = started;
    let submittedAt = this.#now();
    while (job.status === "queued" || job.status === "processing") {
      const seconds = Math.min(POLL_MAX_SECONDS, Math.max(POLL_MIN_SECONDS, job.pollAfterSeconds));
      yield* Effect.sleep(Duration.seconds(seconds));
      if (patient && job.status === "queued" && this.#now() - submittedAt >= RESUBMIT_AFTER_MS) {
        submittedAt = this.#now();
        job = yield* start(started.jobId);
      } else job = yield* this.#again(gateway.job(started.jobId), patient).pipe(Effect.mapError(failedOf));
    }
    return job;
  });

  #produce = Effect.fn("CreditMediaWorkflows.produce")(function* (
    this: CreditMediaWorkflows,
    start: (jobId: string) => Effect.Effect<CreditMediaJob, McpMediaFailed>,
    jobId: string,
    earlierJobIds: readonly string[],
    patient = false,
  ) {
    if (!(yield* this.#signedIn())) return yield* mediaFail(sourceText("error.billing.mediaSignInRequired"));
    const existing = (yield* this.#existing(jobId, patient)) ?? (yield* this.#earlier(earlierJobIds));
    const started =
      existing === null ? yield* start(jobId) : existing.status === "queued" ? yield* start(existing.jobId) : existing;
    const done = yield* this.#wait(started, start, patient);
    if (existing === null || existing.status === "queued" || existing.status === "processing")
      this.#options.creditsChanged?.();
    if (done.status === "failed" && done.reason === "content_policy")
      return yield* mediaFail(sourceText("error.billing.mediaContentRefused"));
    if (done.status === "failed" && done.failure === "refused")
      return yield* mediaFail(sourceText("error.billing.mediaRequestRefused"));
    if (done.status !== "completed") return yield* mediaFailed();
    const output = done.outputs[0];
    if (!output) return yield* mediaFailed();
    const bytes = yield* this.#again(this.#options.gateway.output(done.jobId, output.index), patient).pipe(
      Effect.mapError(failedOf),
    );
    return { bytes, mimeType: output.mimeType, credits: done.credits } satisfies CreditMediaMade;
  });

  readonly unfinished = Effect.fn("CreditMediaWorkflows.unfinished")(function* (
    this: CreditMediaWorkflows,
    jobId: string,
  ) {
    const found = yield* this.#existing(jobId, true).pipe(Effect.orElseSucceed(() => null));
    return found !== null && found.status !== "failed" && found.status !== "canceled";
  }).bind(this);

  readonly models = Effect.fn("CreditMediaWorkflows.models")(function* (this: CreditMediaWorkflows) {
    const models = yield* this.#models();
    return models ? [...models.values()] : [];
  }).bind(this);

  readonly make = Effect.fn("CreditMediaWorkflows.make")(function* (
    this: CreditMediaWorkflows,
    read: CreditMediaInputRead,
    request: CreditMediaAgentRequest,
  ) {
    return yield* this.#produce(
      (jobId) => this.#submitJob(read, request.model, { ...request.job, jobId }, request.images, true),
      request.jobId,
      [],
      true,
    );
  }).bind(this);

  readonly generate = Effect.fn("CreditMediaWorkflows.generate")(function* (
    this: CreditMediaWorkflows,
    dependencies: Pick<McpMediaDependencies, "resolveAttachment" | "store">,
    request: CreditMediaRequest,
  ) {
    const read = workflowAttachmentRead(dependencies.resolveAttachment);
    const made = yield* this.#produce(
      (jobId) => this.#submit(read, { ...request, jobId }),
      request.jobId,
      request.earlierJobIds,
    );
    const extension =
      made.mimeType
        .split("/")[1]
        ?.replace(/[^a-z0-9]/giu, "")
        .slice(0, 8) || "bin";
    const stored = yield* dependencies
      .store({
        bytes: made.bytes,
        kind: request.kind,
        name: `openbot-${request.kind}.${extension}`,
        mimeType: made.mimeType,
      })
      .pipe(Effect.mapError(() => mediaFailed()));
    return stored.id;
  }).bind(this);
}
