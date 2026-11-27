import { randomUUID } from "node:crypto";
import { attachmentMimeTypeForName } from "@openbot/contracts/attachment-files";
import {
  CREDIT_MEDIA_PROMPT_LIMIT,
  CREDIT_MEDIA_REFERENCE_LIMIT,
  type CreditMediaBalance,
  type CreditMediaGenerationKind,
  type CreditMediaInputRole,
  type CreditMediaJobRequest,
  type CreditMediaModel,
  type CreditMediaRequestProblem,
  creditMediaCost,
  creditMediaRequestProblem,
  creditMediaSpendable,
} from "@openbot/contracts/credit-media";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type ImageGenerationAspectRatio,
  type ImageGenerationInfo,
  imageAspectRatioOf,
  imagePixelSizeText,
  MEDIA_APPROVAL_MODEL_LIMIT,
  type MediaApprovalChoice,
  type MediaApprovalOffer,
  type VideoGenerationInfo,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Exit, Fiber, Option, type Scope } from "effect";
import { z } from "zod";
import { imageSizeOfBytes } from "../image-size";
import type { DynamicToolResult } from "../protocol";
import type { CreditMediaInputRead, CreditMediaWorkflows } from "../workflows/credit-media";
import type { CreditAnswerVia, CreditsHoldAnswer, CreditsHoldCall, CreditsHoldWallet } from "./attention-registry";
import { generatedImageName, generatedVideoName } from "./image-generation";
import type { ImageFitter } from "./image-reader";
import { openBotToolFailure, openBotToolResult } from "./routine-tools";

export const LIST_MEDIA_MODELS_TOOL = "list_media_models";
const GENERATE_IMAGE_TOOL = "generate_image";
const GENERATE_VIDEO_TOOL = "generate_video";

export const CREDIT_MEDIA_TOOL_NAMES: ReadonlySet<string> = new Set([
  LIST_MEDIA_MODELS_TOOL,
  GENERATE_IMAGE_TOOL,
  GENERATE_VIDEO_TOOL,
]);

export const DEFAULT_MEDIA_APPROVAL_CREDITS = 50;

const localPath = z.string().trim().min(1).max(INPUT_LIMITS.path);
const modelId = z.string().trim().min(1).max(80);
const specValue = z.string().trim().min(1).max(16);
const prompt = z.string().max(CREDIT_MEDIA_PROMPT_LIMIT);

const listMediaModelsToolSchema = z.strictObject({
  kind: z.enum(["image", "video"]).optional(),
});

const generateImageToolSchema = z.strictObject({
  prompt: prompt.describe("What the image shows, in detail."),
  model: modelId.describe("An id from list_media_models. Omit for the default.").optional(),
  aspect: specValue.describe('Such as "16:9". Omit for the model default.').optional(),
  resolution: specValue.describe("Omit for the model default.").optional(),
  images: z
    .array(localPath)
    .max(CREDIT_MEDIA_REFERENCE_LIMIT)
    .describe("Local PNG, JPEG or WebP pictures to edit or use as references.")
    .optional(),
});

const generateVideoToolSchema = z.strictObject({
  prompt: prompt.describe("Subject, motion, camera and sound."),
  model: modelId.describe("An id from list_media_models. Omit for the default.").optional(),
  aspect: specValue.describe('Such as "16:9". Omit for the model default.').optional(),
  resolution: specValue.describe("Omit for the model default.").optional(),
  duration: z.number().int().min(1).max(600).describe("Seconds, from the model durations.").optional(),
  audio: z.boolean().describe("False for a silent video. Default true.").optional(),
  firstFrame: localPath.describe("A local picture for the first frame.").optional(),
  lastFrame: localPath.describe("A local picture for the last frame.").optional(),
  images: z.array(localPath).max(CREDIT_MEDIA_REFERENCE_LIMIT).describe("Local reference pictures.").optional(),
});

const PAID_RULE =
  "It spends OpenBot credits. OpenBot asks the user above the price limit, so do not ask for approval yourself.";

const OWN_TOOL_RULE =
  "only when you have no such tool of your own, when the user asks for OpenBot credits, or when the user names a model that your own tool cannot make.";

export const CREDIT_MEDIA_TOOL_DEFINITIONS = [
  {
    name: LIST_MEDIA_MODELS_TOOL,
    description:
      "List the models of generate_image and generate_video with their options and prices, the default model of each kind, the credit balance, freeCredits (they pay only for models with takesFreeCredits), and askAboveCredits: the price above which OpenBot asks the user.",
    shape: listMediaModelsToolSchema.shape,
  },
  {
    name: GENERATE_IMAGE_TOOL,
    description: `Make one image from a prompt, or edit local pictures, and show it in the chat. Use it ${OWN_TOOL_RULE} ${PAID_RULE} Do not repeat the image. The result gives the saved file for images or firstFrame of a later call.`,
    shape: generateImageToolSchema.shape,
  },
  {
    name: GENERATE_VIDEO_TOOL,
    description: `Make one video from a prompt, frames or reference pictures, and show it in the chat. Use it ${OWN_TOOL_RULE} Use it before you draw frames yourself. It can take some minutes. ${PAID_RULE} Do not repeat the video.`,
    shape: generateVideoToolSchema.shape,
  },
];

export interface CreditMediaShown {
  bytes: Uint8Array;
  name: string;
  mimeType: string;
  itemType: "image_generation" | "video_generation";
  imageGeneration?: ImageGenerationInfo;
  videoGeneration?: VideoGenerationInfo;
}

export interface CreditMediaToolCall {
  agentId: string;
  turnId: string;
  tool: string;
  arguments: unknown;
  readInputs: (paths: readonly string[]) => Effect.Effect<readonly Uint8Array[], CreditMediaToolInputFailed>;
  approve: (reason: string, offer: MediaApprovalOffer) => Effect.Effect<CreditMediaApproval>;
  hold: (
    reason: string,
    hold: { call: CreditsHoldCall; balance: number | null; wallet: CreditsHoldWallet },
  ) => Effect.Effect<CreditsHoldAnswer>;
  requesters: readonly string[];
  show: (media: CreditMediaShown) => Effect.Effect<string | null, unknown>;
  answerBefore?: CreditMediaAnswerBefore;
}

export interface CreditMediaAnswerBefore {
  at: number;
  late: (result: string) => void;
}

export interface CreditAsksPerson {
  id: string;
  canAdminister: boolean;
}

interface CreditMediaApproval {
  accepted: boolean;
  choice: MediaApprovalChoice | null;
  via: CreditAnswerVia | null;
}

export type CreditMediaOutcome =
  | "generated"
  | "failed"
  | "not_saved"
  | "declined"
  | "skipped"
  | "muted"
  | "not_asked"
  | "short"
  | "invalid"
  | "input_failed"
  | "stopped"
  | "unavailable";

type CreditsHoldOutcome = "continued" | "enabled" | "skipped" | "muted" | "not_asked" | "stopped";

export interface CreditMediaReport {
  agentId: string;
  turnId: string;
  kind: CreditMediaGenerationKind;
  outcome: CreditMediaOutcome;
  agentModel: string | null;
  model: string | null;
  modelSource: "agent" | "default" | null;
  cost: number | null;
  charged: number | null;
  resolution: string | null;
  durationSeconds: number | null;
  audio: boolean | null;
  references: number;
  hold: { reason: "balance" | "agents_off"; answer: CreditsHoldOutcome | null; via: CreditAnswerVia | null } | null;
  approval: { accepted: boolean; via: CreditAnswerVia | null; modelChanged: boolean } | null;
  durationMs: number;
}

interface CreditMediaRun {
  facts: Omit<CreditMediaReport, "durationMs">;
  startedAt: number;
  delivering: boolean;
}

export class CreditMediaToolInputFailed extends Error {}

export interface CreditMediaToolsOptions {
  media: () => CreditMediaWorkflows | null;
  approvalCredits: () => number;
  agentsAllowed: () => boolean;
  enableAgents: () => Effect.Effect<void, unknown>;
  askWhenBlocked: () => boolean;
  asksMuted: (personIds: readonly string[]) => boolean;
  muteAsks: (person: CreditAsksPerson | null) => Effect.Effect<void, unknown>;
  defaultModels: (kind: CreditMediaGenerationKind) => readonly string[];
  fitImage: ImageFitter | null;
  scope: () => Scope.Scope;
  report?: (report: CreditMediaReport) => void;
}

interface Inputs {
  first: string | null;
  last: string | null;
  references: readonly string[];
}

type JobArguments = {
  prompt: string;
  model?: string | undefined;
  aspect?: string | undefined;
  resolution?: string | undefined;
  duration?: number | undefined;
  audio?: boolean | undefined;
};

interface PlannedJob {
  model: CreditMediaModel;
  job: Omit<CreditMediaJobRequest, "jobId">;
  inputs: Inputs;
  cost: number;
  freeNote: string | null;
}

const failure = (message: string) => openBotToolFailure(message);

const STILL_MAKING_NOTE =
  "It is still being made. It shows in the chat when it is ready, and its result arrives as the user's next message. Do not call the tool again for it. End your turn unless other work does not need it.";

function resultText(result: DynamicToolResult): string {
  return result.contentItems.flatMap((item) => (item.type === "inputText" ? [item.text] : [])).join("\n");
}

interface Blocked {
  reason: "balance" | "agentsOff";
  balance: number | null;
}

const NOT_AGAIN = "Nothing was spent. Do not try again with credits in this turn.";

function blockedText(blocked: Blocked, cost: number): string {
  return blocked.reason === "agentsOff"
    ? "Agents on this server cannot use credits."
    : `This costs ${cost} credits, and the balance is ${blocked.balance ?? 0}.`;
}

function spendableFor(media: CreditMediaWorkflows, model: CreditMediaModel) {
  return media
    .balance()
    .pipe(Effect.map((balance) => (balance ? creditMediaSpendable(balance, model.welcome === true) : null)));
}

function listedModel(model: CreditMediaModel) {
  return {
    id: model.id,
    kind: model.kind,
    name: model.variant ? `${model.name} · ${model.variant}` : model.name,
    maker: model.maker,
    aspects: model.aspects,
    defaultAspect: model.defaultAspect,
    resolutions: model.resolutions,
    defaultResolution: model.defaultResolution,
    ...(model.kind === "video"
      ? {
          durations: model.durations,
          defaultDuration: model.defaultDuration,
          firstFrame: model.frames >= 1,
          lastFrame: model.frames >= 2,
          audio: model.audio,
        }
      : {}),
    referencePictures: model.references,
    promptRequired: model.promptRequired,
    ...(model.welcome ? { takesFreeCredits: true } : {}),
    prices: model.prices.map((price) => ({
      resolution: price.resolution,
      per: price.unit,
      credits: price.credits,
      ...(price.silentCredits === null ? {} : { silentCredits: price.silentCredits }),
    })),
  };
}

function takesInputs(model: CreditMediaModel, inputs: Inputs): boolean {
  const frames = model.kind === "video" ? model.frames : 0;
  if (inputs.first !== null && frames < 1) return false;
  if (inputs.last !== null && frames < 2) return false;
  return inputs.references.length <= model.references;
}

function inputProblem(model: CreditMediaModel, inputs: Inputs): string | null {
  const frames = model.kind === "video" ? model.frames : 0;
  if (inputs.first !== null && frames < 1) return `${model.id} takes no first frame.`;
  if (inputs.last !== null && frames < 2) return `${model.id} takes no last frame.`;
  if (inputs.last !== null && inputs.first === null) return "Give firstFrame with lastFrame.";
  if (inputs.references.length > model.references)
    return model.references === 0
      ? `${model.id} takes no reference pictures.`
      : `${model.id} takes at most ${model.references} reference pictures.`;
  return null;
}

function requestProblemText(model: CreditMediaModel, problem: CreditMediaRequestProblem): string {
  switch (problem) {
    case "aspect":
      return `aspect must be one of: ${model.aspects.join(", ")}.`;
    case "resolution":
      return `resolution must be one of: ${model.resolutions.join(", ")}.`;
    case "duration":
      return `duration must be one of: ${model.durations.join(", ")} seconds.`;
    case "prompt":
      return "prompt is required for this model.";
    case "audio":
      return `${model.id} makes no sound.`;
    case "count":
    case "model":
      return `${model.id} cannot make this request.`;
  }
}

function aspectRatioOf(aspect: string | null, fallback: ImageGenerationAspectRatio): ImageGenerationAspectRatio {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect ?? "");
  const width = Number(match?.[1] ?? 0);
  const height = Number(match?.[2] ?? 0);
  return width > 0 && height > 0 ? imageAspectRatioOf({ width, height }) : fallback;
}

function extensionOf(mimeType: string): string {
  return (
    mimeType
      .split("/")[1]
      ?.replace(/[^a-z0-9]/giu, "")
      .slice(0, 8) || "bin"
  );
}

function chosenModel(
  ofKind: readonly CreditMediaModel[],
  requested: string | undefined,
  defaultModels: readonly string[],
  inputs: Inputs,
): CreditMediaModel | undefined {
  if (requested !== undefined) return ofKind.find((candidate) => candidate.id === requested);
  for (const id of defaultModels) {
    const preferred = ofKind.find((candidate) => candidate.id === id);
    if (preferred && takesInputs(preferred, inputs)) return preferred;
  }
  return ofKind.find((candidate) => takesInputs(candidate, inputs));
}

function plannedJob(
  models: readonly CreditMediaModel[],
  kind: CreditMediaGenerationKind,
  args: JobArguments,
  inputs: Inputs,
  defaultModels: readonly string[],
): PlannedJob | string {
  const ofKind = models.filter((model) => model.kind === kind);
  if (ofKind.length === 0) return `No ${kind} model is available now. Try again later.`;
  const model = chosenModel(ofKind, args.model, defaultModels, inputs);
  if (!model)
    return args.model === undefined
      ? `No ${kind} model takes these pictures. Call ${LIST_MEDIA_MODELS_TOOL}.`
      : `${args.model} is not a ${kind} model. Call ${LIST_MEDIA_MODELS_TOOL} for the model ids.`;
  const problem = inputProblem(model, inputs);
  if (problem) return problem;
  const job: Omit<CreditMediaJobRequest, "jobId"> = {
    model: model.id,
    prompt: args.prompt,
    aspect: args.aspect ?? model.defaultAspect ?? model.aspects[0] ?? null,
    resolution: args.resolution ?? model.defaultResolution ?? model.resolutions[0] ?? null,
    duration: kind === "video" ? (args.duration ?? model.defaultDuration ?? model.durations[0] ?? null) : null,
    count: 1,
    audio: model.audio && args.audio !== false,
  };
  const requestProblem = creditMediaRequestProblem(model, { ...job, jobId: "" });
  if (requestProblem) return requestProblemText(model, requestProblem);
  const cost = creditMediaCost(model, job);
  if (cost === null) return `${model.id} has no price for this request. Choose another resolution or model.`;
  return { model, job, inputs, cost, freeNote: null };
}

function settingChoices(model: CreditMediaModel, args: JobArguments): JobArguments[] {
  const resolutions: (string | undefined)[] =
    args.resolution === undefined && model.resolutions.length > 0 ? [...model.resolutions] : [args.resolution];
  const durations: (number | undefined)[] =
    model.kind === "video" && args.duration === undefined && model.durations.length > 0
      ? [...model.durations]
      : [args.duration];
  return resolutions.flatMap((resolution) =>
    durations.map((duration) => ({ ...args, model: model.id, resolution, duration })),
  );
}

function freeFit(
  models: readonly CreditMediaModel[],
  kind: CreditMediaGenerationKind,
  args: JobArguments,
  inputs: Inputs,
  credits: number,
): PlannedJob | null {
  const free = models.filter((model) => model.kind === kind && model.welcome === true && takesInputs(model, inputs));
  const fits = (planned: PlannedJob | string): planned is PlannedJob =>
    typeof planned !== "string" && planned.cost <= credits;
  const asked = free
    .map((model) => plannedJob(models, kind, { ...args, model: model.id }, inputs, []))
    .filter(fits)
    .sort((a, b) => a.cost - b.cost);
  if (asked[0]) return asked[0];
  const reduced = free
    .flatMap((model) => settingChoices(model, args).map((choice) => plannedJob(models, kind, choice, inputs, [])))
    .filter(fits)
    .sort((a, b) => (b.job.duration ?? 0) - (a.job.duration ?? 0) || b.cost - a.cost);
  return reduced[0] ?? null;
}

function freeOfferText(tool: string, short: PlannedJob, spendable: number, free: PlannedJob): string {
  const settings = [
    `model "${free.model.id}"`,
    ...(free.job.resolution === null ? [] : [`resolution "${free.job.resolution}"`]),
    ...(free.job.duration === null ? [] : [`duration ${free.job.duration}`]),
  ].join(", ");
  const balance =
    short.model.welcome === true
      ? `the free credits are ${spendable}, too few for these settings`
      : `the paid balance is ${spendable}`;
  const next =
    free.model.id === short.model.id
      ? `It fits at lower settings: call ${tool} again with ${settings} (${free.cost} credits).`
      : `${listedModel(free.model).name} takes free credits: call ${tool} again with ${settings} (${free.cost} credits).`;
  return `Nothing was spent. ${short.model.id} costs ${short.cost} credits, and ${balance}. ${next} When the user named ${short.model.id}, ask the user first; they add paid credits in Settings > Credits.`;
}

function settingsText(planned: PlannedJob): string {
  return [
    ...(planned.job.resolution === null ? [] : [planned.job.resolution]),
    ...(planned.job.duration === null ? [] : [`${planned.job.duration} s`]),
  ].join(", ");
}

function freeNoteText(asked: PlannedJob, free: PlannedJob): string {
  const askedName = listedModel(asked.model).name;
  const freeName = listedModel(free.model).name;
  const settings = settingsText(free);
  const used = settings === "" ? freeName : `${freeName} at ${settings}`;
  if (asked.model.welcome !== true)
    return `The paid balance was too low for ${askedName}, so OpenBot used ${used}, which takes free credits.`;
  if (free.model.id === asked.model.id)
    return `The free credits were too few for ${askedName} at the asked settings, so OpenBot used ${used}.`;
  return `The free credits were too few for ${askedName}, so OpenBot used ${used}, which also takes free credits.`;
}

function freeNote(planned: PlannedJob): { note?: string } {
  return planned.freeNote === null ? {} : { note: planned.freeNote };
}

function choiceOf(planned: PlannedJob): MediaApprovalChoice {
  return {
    model: planned.model.id,
    aspect: planned.job.aspect,
    resolution: planned.job.resolution,
    duration: planned.job.duration,
    audio: planned.job.audio,
  };
}

function approvalOffer(
  models: readonly CreditMediaModel[],
  kind: CreditMediaGenerationKind,
  planned: PlannedJob,
  defaultModels: readonly string[],
  balance: CreditMediaBalance | null,
): MediaApprovalOffer {
  const others = models.filter(
    (model) => model.kind === kind && model.id !== planned.model.id && inputProblem(model, planned.inputs) === null,
  );
  const offered = [planned.model, ...others].slice(0, MEDIA_APPROVAL_MODEL_LIMIT);
  return {
    kind,
    prompt: planned.job.prompt,
    agentModel: planned.model.id,
    choice: choiceOf(planned),
    defaultModel: defaultModels.find((id) => offered.some((model) => model.id === id)) ?? null,
    canSetDefault: true,
    models: offered,
    ...(balance ? { balance: { available: balance.available, welcome: balance.welcome ?? 0 } } : {}),
  };
}

function argumentsOf(prompt: string, choice: MediaApprovalChoice): JobArguments {
  return {
    prompt,
    model: choice.model,
    ...(choice.aspect === null ? {} : { aspect: choice.aspect }),
    ...(choice.resolution === null ? {} : { resolution: choice.resolution }),
    ...(choice.duration === null ? {} : { duration: choice.duration }),
    audio: choice.audio,
  };
}

interface InputRole {
  role: CreditMediaInputRole;
  path: string;
}

function startRun(call: CreditMediaToolCall, kind: CreditMediaGenerationKind): CreditMediaRun {
  return {
    facts: {
      agentId: call.agentId,
      turnId: call.turnId,
      kind,
      outcome: "failed",
      agentModel: null,
      model: null,
      modelSource: null,
      cost: null,
      charged: null,
      resolution: null,
      durationSeconds: null,
      audio: null,
      references: 0,
      hold: null,
      approval: null,
    },
    startedAt: Date.now(),
    delivering: false,
  };
}

function notePlan(run: CreditMediaRun, planned: PlannedJob): void {
  run.facts.model = planned.model.id;
  run.facts.cost = planned.cost;
  run.facts.resolution = planned.job.resolution;
  run.facts.durationSeconds = planned.job.duration;
  run.facts.audio = run.facts.kind === "video" ? planned.job.audio : null;
}

function exitOutcome(exit: Exit.Exit<unknown, unknown>, outcome: CreditMediaOutcome): CreditMediaOutcome {
  if (Exit.isSuccess(exit)) return outcome;
  return Exit.hasInterrupts(exit) ? "stopped" : "failed";
}

function holdOutcome(answer: CreditsHoldAnswer): CreditsHoldOutcome {
  if (answer.stopped) return "stopped";
  if (answer.action === "skip") return "skipped";
  if (answer.action === "mute") return "muted";
  return answer.enabled ? "enabled" : "continued";
}

function inputRoles(inputs: Inputs): InputRole[] {
  return [
    ...(inputs.first === null ? [] : [{ role: "first" as const, path: inputs.first }]),
    ...(inputs.last === null ? [] : [{ role: "last" as const, path: inputs.last }]),
    ...inputs.references.map((path) => ({ role: "reference" as const, path })),
  ];
}

export class CreditMediaTools {
  readonly #options: CreditMediaToolsOptions;

  constructor(options: CreditMediaToolsOptions) {
    this.#options = options;
  }

  readonly handle = Effect.fn("CreditMediaTools.handle")(function* (this: CreditMediaTools, call: CreditMediaToolCall) {
    const media = this.#options.media();
    if (call.tool === LIST_MEDIA_MODELS_TOOL) {
      if (!media?.available()) return failure(sourceText("error.billing.mediaSignInRequired"));
      return yield* this.#list(media, call);
    }
    const run = startRun(call, call.tool === GENERATE_IMAGE_TOOL ? "image" : "video");
    return yield* this.#generateTool(media, call, run).pipe(
      Effect.onExit((exit) => (run.delivering ? Effect.void : this.#report(run, exitOutcome(exit, run.facts.outcome)))),
    );
  }).bind(this);

  #generateTool = Effect.fn("CreditMediaTools.generateTool")(function* (
    this: CreditMediaTools,
    media: CreditMediaWorkflows | null,
    call: CreditMediaToolCall,
    run: CreditMediaRun,
  ) {
    if (!media?.available()) {
      run.facts.outcome = "unavailable";
      return failure(sourceText("error.billing.mediaSignInRequired"));
    }
    if (run.facts.kind === "image") {
      const parsed = generateImageToolSchema.safeParse(call.arguments, { reportInput: true });
      if (!parsed.success) {
        run.facts.outcome = "invalid";
        return failure(z.prettifyError(parsed.error));
      }
      const { images, ...args } = parsed.data;
      return yield* this.#generate(media, call, run, args, { first: null, last: null, references: images ?? [] });
    }
    const parsed = generateVideoToolSchema.safeParse(call.arguments, { reportInput: true });
    if (!parsed.success) {
      run.facts.outcome = "invalid";
      return failure(z.prettifyError(parsed.error));
    }
    const { firstFrame, lastFrame, images, ...args } = parsed.data;
    return yield* this.#generate(media, call, run, args, {
      first: firstFrame ?? null,
      last: lastFrame ?? null,
      references: images ?? [],
    });
  });

  #report(run: CreditMediaRun, outcome: CreditMediaOutcome) {
    const report = this.#options.report;
    if (!report) return Effect.void;
    return Effect.sync(() => report({ ...run.facts, outcome, durationMs: Date.now() - run.startedAt })).pipe(
      Effect.catchDefect(() => Effect.void),
    );
  }

  #defaultModelIn(models: readonly CreditMediaModel[], kind: CreditMediaGenerationKind): string | null {
    const preferred = this.#options.defaultModels(kind);
    const offered = preferred.find((id) => models.some((model) => model.kind === kind && model.id === id));
    return offered ?? preferred[0] ?? null;
  }

  #list = Effect.fn("CreditMediaTools.list")(function* (
    this: CreditMediaTools,
    media: CreditMediaWorkflows,
    call: CreditMediaToolCall,
  ) {
    const parsed = listMediaModelsToolSchema.safeParse(call.arguments ?? {}, { reportInput: true });
    if (!parsed.success) return failure(z.prettifyError(parsed.error));
    const kind = parsed.data.kind;
    const [models, balance] = yield* Effect.all([media.models(), media.balance()], { concurrency: "unbounded" });
    return openBotToolResult({
      balance: balance?.available ?? null,
      ...(balance?.welcome ? { freeCredits: balance.welcome } : {}),
      agentsCanUseCredits: this.#options.agentsAllowed(),
      askAboveCredits: this.#options.approvalCredits(),
      defaultModels: { image: this.#defaultModelIn(models, "image"), video: this.#defaultModelIn(models, "video") },
      models: models.filter((model) => kind === undefined || model.kind === kind).map(listedModel),
    });
  });

  #generate = Effect.fn("CreditMediaTools.generate")(function* (
    this: CreditMediaTools,
    media: CreditMediaWorkflows,
    call: CreditMediaToolCall,
    run: CreditMediaRun,
    args: JobArguments,
    inputs: Inputs,
  ) {
    const kind = run.facts.kind;
    const roles = inputRoles(inputs);
    run.facts.references = roles.length;
    run.facts.modelSource = args.model === undefined ? "default" : "agent";
    const models = yield* media.models();
    const defaultModels = this.#options.defaultModels(kind);
    const asked = plannedJob(models, kind, args, inputs, defaultModels);
    if (typeof asked === "string") {
      run.facts.outcome = "invalid";
      run.facts.agentModel = args.model ?? null;
      return failure(asked);
    }
    run.facts.agentModel = asked.model.id;
    notePlan(run, asked);
    const free = yield* this.#freeInstead(media, models, kind, args, asked);
    if (free && args.model !== undefined) {
      run.facts.outcome = "short";
      return failure(freeOfferText(call.tool, asked, free.spendable, free.planned));
    }
    const first = free ? { ...free.planned, freeNote: freeNoteText(asked, free.planned) } : asked;
    if (free) notePlan(run, first);
    const held = yield* this.#holdUntilFunded(media, call, run, first.model, first.cost);
    if (held) return failure(held);
    const read = yield* Effect.result(call.readInputs(roles.map(({ path }) => path)));
    if (read._tag === "Failure") {
      run.facts.outcome = "input_failed";
      return failure(read.failure.message);
    }
    const files = read.success;
    let planned = first;
    if (first.cost > this.#options.approvalCredits()) {
      const name = listedModel(first.model).name;
      const reason =
        kind === "image"
          ? sourceText("status.agent.creditImageApproval", { model: name, credits: first.cost })
          : sourceText("status.agent.creditVideoApproval", { model: name, credits: first.cost });
      const balance = yield* media.balance();
      const approval = yield* call.approve(reason, approvalOffer(models, kind, first, defaultModels, balance));
      run.facts.approval = {
        accepted: approval.accepted,
        via: approval.via,
        modelChanged: approval.choice !== null && approval.choice.model !== first.model.id,
      };
      if (!approval.accepted) {
        run.facts.outcome = approval.via === null ? "stopped" : "declined";
        return failure(sourceText("error.agent.creditMediaDeclined"));
      }
      if (approval.choice) {
        const chosen = plannedJob(models, kind, argumentsOf(args.prompt, approval.choice), inputs, defaultModels);
        if (typeof chosen === "string") {
          run.facts.outcome = "invalid";
          return failure(chosen);
        }
        notePlan(run, chosen);
        const chosenFunded = yield* this.#funded(media, chosen);
        if (chosenFunded) {
          run.facts.outcome = "short";
          return failure(chosenFunded);
        }
        planned = chosen;
      }
    }
    const readInput: CreditMediaInputRead = (attachmentId) => {
      const index = Number(attachmentId);
      const role = roles[index];
      const bytes = files[index];
      return Effect.succeed(
        role && bytes ? { mimeType: attachmentMimeTypeForName(role.path), bytes: Effect.succeed(bytes) } : null,
      );
    };
    const delivery = yield* Effect.suspend(() => {
      run.delivering = true;
      return this.#deliver(media, call, run, planned, readInput, roles);
    }).pipe(
      Effect.onExit((exit) => this.#report(run, exitOutcome(exit, run.facts.outcome))),
      Effect.forkIn(this.#options.scope(), { startImmediately: true }),
    );
    const answerBefore = call.answerBefore;
    if (!answerBefore) return yield* Fiber.join(delivery);
    const early = yield* Fiber.join(delivery).pipe(Effect.timeoutOption(Math.max(0, answerBefore.at - Date.now())));
    if (Option.isSome(early)) return early.value;
    yield* Fiber.join(delivery).pipe(
      Effect.flatMap((result) => Effect.sync(() => answerBefore.late(resultText(result)))),
      Effect.ignore,
      Effect.forkIn(this.#options.scope(), { startImmediately: true }),
    );
    return openBotToolResult({ status: "making", next: STILL_MAKING_NOTE });
  });

  #deliver = Effect.fn("CreditMediaTools.deliver")(function* (
    this: CreditMediaTools,
    media: CreditMediaWorkflows,
    call: CreditMediaToolCall,
    run: CreditMediaRun,
    planned: PlannedJob,
    readInput: CreditMediaInputRead,
    roles: readonly InputRole[],
  ) {
    const kind = run.facts.kind;
    const made = yield* Effect.result(
      media.make(readInput, {
        jobId: randomUUID(),
        model: planned.model,
        job: planned.job,
        images: roles.map(({ role }, index) => ({ role, attachmentId: String(index) })),
      }),
    );
    if (made._tag === "Failure") {
      run.facts.outcome = "failed";
      return failure(made.failure.message);
    }
    const { bytes, mimeType, credits } = made.success;
    run.facts.charged = credits;
    const extension = extensionOf(mimeType);
    const size = kind === "image" ? imageSizeOfBytes(bytes) : null;
    const shown = yield* Effect.result(
      call.show(
        kind === "image"
          ? {
              bytes,
              mimeType,
              name: generatedImageName(`image.${extension}`),
              itemType: "image_generation",
              imageGeneration: {
                prompt: planned.job.prompt,
                resolution: size ? imagePixelSizeText(size) : (planned.job.resolution ?? ""),
                aspectRatio: size ? imageAspectRatioOf(size) : aspectRatioOf(planned.job.aspect, "square"),
              },
            }
          : {
              bytes,
              mimeType,
              name: generatedVideoName(`video.${extension}`, planned.job.prompt),
              itemType: "video_generation",
              videoGeneration: {
                prompt: planned.job.prompt,
                aspectRatio: aspectRatioOf(planned.job.aspect, "landscape"),
                ...(planned.job.duration === null ? {} : { durationSeconds: planned.job.duration }),
                ...(planned.job.resolution === null ? {} : { resolution: planned.job.resolution }),
              },
            },
      ),
    );
    if (shown._tag === "Failure") {
      run.facts.outcome = "not_saved";
      return failure(sourceText("error.agent.creditMediaNotSaved"));
    }
    run.facts.outcome = "generated";
    const file = shown.success === null ? {} : { file: shown.success };
    if (kind === "image") return this.#imageResult(planned, credits, bytes, size, file);
    return openBotToolResult({
      status: "shown",
      model: planned.model.id,
      credits,
      duration: planned.job.duration,
      resolution: planned.job.resolution,
      ...file,
      ...freeNote(planned),
    });
  });

  #blocked = Effect.fn("CreditMediaTools.blocked")(function* (
    this: CreditMediaTools,
    media: CreditMediaWorkflows,
    model: CreditMediaModel,
    cost: number,
  ) {
    if (!this.#options.agentsAllowed()) return { reason: "agentsOff", balance: null } satisfies Blocked;
    const spendable = yield* spendableFor(media, model);
    if (spendable === null || cost <= spendable) return null;
    return { reason: "balance", balance: spendable } satisfies Blocked;
  });

  #freeInstead = Effect.fn("CreditMediaTools.freeInstead")(function* (
    this: CreditMediaTools,
    media: CreditMediaWorkflows,
    models: readonly CreditMediaModel[],
    kind: CreditMediaGenerationKind,
    args: JobArguments,
    asked: PlannedJob,
  ) {
    if (!this.#options.agentsAllowed()) return null;
    const balance = yield* media.balance();
    if (!balance?.welcome) return null;
    const spendable = creditMediaSpendable(balance, asked.model.welcome === true);
    if (asked.cost <= spendable) return null;
    const planned = freeFit(models, kind, args, asked.inputs, creditMediaSpendable(balance, true));
    return planned ? { planned, spendable } : null;
  });

  #holdUntilFunded = Effect.fn("CreditMediaTools.holdUntilFunded")(function* (
    this: CreditMediaTools,
    media: CreditMediaWorkflows,
    call: CreditMediaToolCall,
    run: CreditMediaRun,
    model: CreditMediaModel,
    cost: number,
  ) {
    const kind = run.facts.kind;
    const blocked = yield* this.#blocked(media, model, cost);
    if (!blocked) return null;
    const hold: NonNullable<CreditMediaReport["hold"]> = {
      reason: blocked.reason === "agentsOff" ? "agents_off" : "balance",
      answer: null,
      via: null,
    };
    run.facts.hold = hold;
    if (!this.#options.askWhenBlocked() || this.#options.asksMuted(call.requesters)) {
      hold.answer = "not_asked";
      run.facts.outcome = "not_asked";
      return `${blockedText(blocked, cost)} The user turned off credit requests, so OpenBot did not ask. ${NOT_AGAIN} Tell the user once, in a few words, that you skipped this step.`;
    }
    const reason =
      blocked.reason === "agentsOff"
        ? sourceText("status.agent.creditsHoldAgentsOff")
        : sourceText("status.agent.creditsHoldBalance", { credits: cost, balance: blocked.balance ?? 0 });
    const wallet: CreditsHoldWallet = {
      agentsAllowed: () => this.#options.agentsAllowed(),
      enableAgents: () => this.#options.enableAgents(),
      balance: () => spendableFor(media, model),
    };
    const answer = yield* call.hold(reason, { call: { kind, cost }, balance: blocked.balance, wallet });
    hold.answer = holdOutcome(answer);
    hold.via = answer.via ?? null;
    if (answer.action === "continue") return null;
    run.facts.outcome = answer.stopped ? "stopped" : answer.action === "skip" ? "skipped" : "muted";
    if (answer.action === "skip") return `The user skipped this step. ${NOT_AGAIN}`;
    const person = answer.responder?.person ?? null;
    yield* this.#options.muteAsks(person).pipe(Effect.ignore);
    return `The user skipped this step and asked OpenBot not to ask about credits again. ${NOT_AGAIN}`;
  });

  #funded = Effect.fn("CreditMediaTools.funded")(function* (media: CreditMediaWorkflows, planned: PlannedJob) {
    const spendable = yield* spendableFor(media, planned.model);
    if (spendable === null || planned.cost <= spendable) return null;
    return `This costs ${planned.cost} credits, and the balance for this model is ${spendable}. Tell the user to add credits in Settings > Credits. Nothing was spent.`;
  });

  #imageResult(
    planned: PlannedJob,
    credits: number,
    bytes: Uint8Array,
    size: { width: number; height: number } | null,
    file: { file?: string },
  ): DynamicToolResult {
    const summary = {
      status: "shown",
      model: planned.model.id,
      credits,
      ...(size ?? {}),
      ...file,
      ...freeNote(planned),
    };
    const fitted = this.#options.fitImage?.(bytes);
    if (!fitted || typeof fitted === "string") return openBotToolResult(summary);
    return {
      success: true,
      contentItems: [
        { type: "inputText", text: JSON.stringify(summary) },
        { type: "inputImage", imageUrl: fitted.dataUrl },
      ],
    } satisfies DynamicToolResult;
  }
}
