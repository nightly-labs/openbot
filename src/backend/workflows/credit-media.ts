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
  creditMediaCost,
  creditMediaRequiredInput,
} from "@openbot/contracts/credit-media";
import {
  WORKFLOW_CREDIT_MODEL_PREFIX,
  WORKFLOW_MEDIA_ASPECTS,
  WORKFLOW_MEDIA_SWITCH_VALUES,
  type WorkflowMediaAspect,
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
import { type McpMediaDependencies, mediaFail, mediaFailed } from "./mcp-media";
import type { MediaPictureRole } from "./workflow-walk";

const CATALOG_TTL_MS = 10 * 60_000;
const FAILED_TTL_MS = 60_000;
const POLL_MIN_SECONDS = 2;
const POLL_MAX_SECONDS = 30;
const SIGN_IN_CHECKS = 30;
const NAME_MAX = 160;
const AUDIO_OPTION = "audio";
const CREDIT_JOB_CONFLICT = "credits_job_conflict";

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
}

interface Listed {
  at: number;
  models: ReadonlyMap<string, CreditMediaModel> | null;
}

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

export function creditWorkflowModel(model: CreditMediaModel): WorkflowMediaCatalogModel {
  const inputs = workflowInputs(model);
  const durations = model.kind === "video" ? model.durations.filter((value) => Number.isSafeInteger(value)) : [];
  const defaultDuration = durations.find((value) => value === model.defaultDuration);
  return {
    id: creditWorkflowModelId(model.id),
    provider: "openbot",
    providerModel: model.id,
    name: (model.variant ? `${model.name} · ${model.variant}` : model.name).slice(0, NAME_MAX),
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

function creditUploadPicks(model: CreditMediaModel, images: CreditMediaRequest["images"]): UploadPick[] {
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

  #models(): Effect.Effect<ReadonlyMap<string, CreditMediaModel> | null> {
    return Effect.suspend(() => {
      if (!this.available()) return Effect.succeed(null);
      const kept = this.#fresh();
      if (kept) return Effect.succeed(kept.models);
      return this.#lock.withPermit(
        Effect.suspend(() => {
          const again = this.#fresh();
          if (again) return Effect.succeed(again.models);
          return this.#options.gateway.catalog().pipe(
            Effect.map((catalog) =>
              catalog.models.length > 0 ? new Map(catalog.models.map((model) => [model.id, model])) : null,
            ),
            Effect.catch((failure) =>
              Effect.sync(() => {
                this.#options.warn("Could not read the credit media models.", { error: failure.message });
                return null;
              }),
            ),
            Effect.tap((models) =>
              Effect.sync(() => {
                this.#listed = { at: this.#now(), models };
              }),
            ),
          );
        }),
      );
    });
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
    const models = yield* this.#models();
    return models ? [...models.values()].map(creditWorkflowModel) : [];
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
    if (!this.available()) return null;
    const balance = yield* this.#options.gateway.balance().pipe(
      Effect.catch((failure) =>
        Effect.sync(() => {
          this.#options.warn("Could not read the media credits.", { error: failure.message });
          return null;
        }),
      ),
    );
    if (!balance) return null;
    return { available: Math.max(0, balance.available), quota: null } satisfies WorkflowMediaCreditBalance;
  }).bind(this);

  #uploads = Effect.fn("CreditMediaWorkflows.uploads")(function* (
    this: CreditMediaWorkflows,
    dependencies: Pick<McpMediaDependencies, "resolveAttachment">,
    model: CreditMediaModel,
    images: CreditMediaRequest["images"],
  ) {
    const picks = creditUploadPicks(model, images);
    const required = creditMediaRequiredInput(model);
    if (required !== null && !picks.some((pick) => pick.role === required))
      return yield* mediaFail(sourceText("error.workflow.creditMediaPictureRequired"));
    const uploads: CreditMediaUpload[] = [];
    let total = 0;
    for (const { attachmentId, role } of picks) {
      const file = yield* dependencies
        .resolveAttachment(attachmentId)
        .pipe(Effect.mapError(() => mediaFail(sourceText("error.workflow.mediaInputMissing"))));
      if (!file) return yield* mediaFail(sourceText("error.workflow.mediaInputMissing"));
      const mimeType = file.mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
      if (!mimeType.startsWith("image/")) return yield* mediaFail(sourceText("error.workflow.mediaInputNotImage"));
      if (!isOneOf(CREDIT_MEDIA_INPUT_TYPES, mimeType))
        return yield* mediaFail(sourceText("error.workflow.mediaInputType"));
      const bytes = yield* Effect.tryPromise({
        try: () => readFile(file.path),
        catch: () => mediaFail(sourceText("error.workflow.mediaInputMissing")),
      });
      total += bytes.byteLength;
      if (bytes.byteLength > CREDIT_MEDIA_INPUT_LIMIT_BYTES || total > CREDIT_MEDIA_INPUTS_LIMIT_BYTES)
        return yield* mediaFail(sourceText("error.workflow.mediaInputTooLarge"));
      uploads.push({ role, bytes: new Uint8Array(bytes), mimeType });
    }
    return uploads;
  });

  #signedIn = Effect.fn("CreditMediaWorkflows.signedIn")(function* (this: CreditMediaWorkflows) {
    for (let check = 1; check < SIGN_IN_CHECKS && !this.available(); check += 1)
      yield* Effect.sleep(Duration.seconds(POLL_MIN_SECONDS));
    return this.available();
  });

  #existing(jobId: string) {
    return this.#options.gateway.job(jobId).pipe(
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

  #submit = Effect.fn("CreditMediaWorkflows.submit")(function* (
    this: CreditMediaWorkflows,
    dependencies: Pick<McpMediaDependencies, "resolveAttachment">,
    request: CreditMediaRequest,
  ) {
    const model = yield* this.#model(request.model);
    if (!model || model.kind !== request.kind)
      return yield* mediaFail(sourceText("error.billing.mediaModelUnavailable"));
    if (model.promptRequired && request.prompt.trim() === "")
      return yield* mediaFail(sourceText("error.workflow.creditMediaPromptRequired"));
    const uploads = yield* this.#uploads(dependencies, model, request.images);
    const gateway = this.#options.gateway;
    return yield* gateway.submit(creditJobRequest(model, request, request.jobId), uploads).pipe(
      Effect.catchIf(
        (failure) => failure.code === CREDIT_JOB_CONFLICT,
        () => gateway.job(request.jobId),
      ),
      Effect.mapError(failedOf),
    );
  });

  #wait = Effect.fn("CreditMediaWorkflows.wait")(function* (this: CreditMediaWorkflows, started: CreditMediaJob) {
    const gateway = this.#options.gateway;
    let job = started;
    while (job.status === "queued" || job.status === "processing") {
      const seconds = Math.min(POLL_MAX_SECONDS, Math.max(POLL_MIN_SECONDS, job.pollAfterSeconds));
      yield* Effect.sleep(Duration.seconds(seconds));
      job = yield* gateway.job(started.jobId).pipe(Effect.mapError(failedOf));
    }
    return job;
  });

  readonly generate = Effect.fn("CreditMediaWorkflows.generate")(function* (
    this: CreditMediaWorkflows,
    dependencies: Pick<McpMediaDependencies, "resolveAttachment" | "store">,
    request: CreditMediaRequest,
  ) {
    if (!(yield* this.#signedIn())) return yield* mediaFail(sourceText("error.billing.mediaSignInRequired"));
    const existing = (yield* this.#existing(request.jobId)) ?? (yield* this.#earlier(request.earlierJobIds));
    const started =
      existing === null
        ? yield* this.#submit(dependencies, request)
        : existing.status === "queued"
          ? yield* this.#submit(dependencies, { ...request, jobId: existing.jobId })
          : existing;
    const done = yield* this.#wait(started);
    if (done.status === "failed" && done.failure === "refused")
      return yield* mediaFail(sourceText("error.billing.mediaRequestRefused"));
    if (done.status !== "completed") return yield* mediaFailed();
    const output = done.outputs[0];
    if (!output) return yield* mediaFailed();
    const bytes = yield* this.#options.gateway.output(done.jobId, output.index).pipe(Effect.mapError(failedOf));
    const extension =
      output.mimeType
        .split("/")[1]
        ?.replace(/[^a-z0-9]/giu, "")
        .slice(0, 8) || "bin";
    const stored = yield* dependencies
      .store({ bytes, kind: request.kind, name: `openbot-${request.kind}.${extension}`, mimeType: output.mimeType })
      .pipe(Effect.mapError(() => mediaFailed()));
    return stored.id;
  }).bind(this);
}
