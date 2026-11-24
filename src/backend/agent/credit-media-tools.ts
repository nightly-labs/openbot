import { randomUUID } from "node:crypto";
import { attachmentMimeTypeForName } from "@openbot/contracts/attachment-files";
import {
  CREDIT_MEDIA_PROMPT_LIMIT,
  CREDIT_MEDIA_REFERENCE_LIMIT,
  type CreditMediaGenerationKind,
  type CreditMediaInputRole,
  type CreditMediaJobRequest,
  type CreditMediaModel,
  type CreditMediaRequestProblem,
  creditMediaCost,
  creditMediaRequestProblem,
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
import { Effect, Fiber, type Scope } from "effect";
import { z } from "zod";
import { imageSizeOfBytes } from "../image-size";
import type { DynamicToolResult } from "../protocol";
import type { CreditMediaInputRead, CreditMediaWorkflows } from "../workflows/credit-media";
import type { CreditsHoldAnswer, CreditsHoldCall, CreditsHoldWallet } from "./attention-registry";
import { generatedImageName, generatedVideoName } from "./image-generation";
import type { ImageFitter } from "./image-reader";
import { openBotToolFailure, openBotToolResult } from "./routine-tools";

export const LIST_MEDIA_MODELS_TOOL = "list_media_models";
export const GENERATE_IMAGE_TOOL = "generate_image";
export const GENERATE_VIDEO_TOOL = "generate_video";

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

export const listMediaModelsToolSchema = z.strictObject({
  kind: z.enum(["image", "video"]).describe("Only list image or video models.").optional(),
});

export const generateImageToolSchema = z.strictObject({
  prompt: prompt.describe("What the image shows. Write it in detail."),
  model: modelId.describe("A model id from list_media_models. Omit it to use the default model.").optional(),
  aspect: specValue.describe('An aspect of the model, such as "16:9". Omit it for the model default.').optional(),
  resolution: specValue.describe("A resolution of the model. Omit it for the model default.").optional(),
  images: z
    .array(localPath)
    .max(CREDIT_MEDIA_REFERENCE_LIMIT)
    .describe("Local PNG, JPEG or WebP pictures to edit or to use as references.")
    .optional(),
});

export const generateVideoToolSchema = z.strictObject({
  prompt: prompt.describe("What happens in the video: subject, motion, camera and sound."),
  model: modelId.describe("A model id from list_media_models. Omit it to use the default model.").optional(),
  aspect: specValue.describe('An aspect of the model, such as "16:9". Omit it for the model default.').optional(),
  resolution: specValue.describe("A resolution of the model. Omit it for the model default.").optional(),
  duration: z.number().int().min(1).max(600).describe("Seconds, from the durations of the model.").optional(),
  audio: z.boolean().describe("False for a silent video, when the model makes sound. Default true.").optional(),
  firstFrame: localPath.describe("A local picture for the first frame.").optional(),
  lastFrame: localPath.describe("A local picture for the last frame.").optional(),
  images: z
    .array(localPath)
    .max(CREDIT_MEDIA_REFERENCE_LIMIT)
    .describe("Local reference pictures, for models that take references.")
    .optional(),
});

const PAID_RULE =
  "It spends OpenBot credits of the user, or of the server wallet on a server. OpenBot asks the user and shows the price when a generation costs more than the limit in list_media_models, so do not ask for approval yourself.";

export const CREDIT_MEDIA_TOOL_DEFINITIONS = [
  {
    name: LIST_MEDIA_MODELS_TOOL,
    description:
      "List the image and video models that generate_image and generate_video can use with OpenBot credits: aspects, resolutions, durations, input pictures and prices. Also returns the default model of each kind, the credit balance and askAboveCredits, the price above which OpenBot asks the user to approve a generation.",
    shape: listMediaModelsToolSchema.shape,
  },
  {
    name: GENERATE_IMAGE_TOOL,
    description: `Make one image from a prompt, or edit local pictures, and show it in this conversation. Use it when the user asks for a picture and you have no image generation tool of your own, when the user asks for OpenBot credits, or when the user names a model that your own tool cannot make. ${PAID_RULE} Do not repeat the image in your reply. The result gives the saved file, to use in images or firstFrame of a later call. With tool_call, openbot.list_media_models gives the models and prices.`,
    shape: generateImageToolSchema.shape,
  },
  {
    name: GENERATE_VIDEO_TOOL,
    description: `Make one video from a prompt, a first and last frame, or reference pictures, and show it in this conversation. Use it when the user asks for a video and you have no video generation model of your own, when the user asks for OpenBot credits, or when the user names a model that your own tool cannot make. Use it before you draw frames or use other tools. It can take some minutes. ${PAID_RULE} Do not repeat the video in your reply.`,
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
}

export interface CreditAsksPerson {
  id: string;
  canAdminister: boolean;
}

export interface CreditMediaApproval {
  accepted: boolean;
  choice: MediaApprovalChoice | null;
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
  defaultModel: (kind: CreditMediaGenerationKind) => string | null;
  fitImage: ImageFitter | null;
  scope: () => Scope.Scope;
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
}

const failure = (message: string) => openBotToolFailure(message);

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
  defaultModel: string | null,
  inputs: Inputs,
): CreditMediaModel | undefined {
  if (requested !== undefined) return ofKind.find((candidate) => candidate.id === requested);
  const preferred = ofKind.find((candidate) => candidate.id === defaultModel);
  if (preferred && takesInputs(preferred, inputs)) return preferred;
  return ofKind.find((candidate) => takesInputs(candidate, inputs));
}

function plannedJob(
  models: readonly CreditMediaModel[],
  kind: CreditMediaGenerationKind,
  args: JobArguments,
  inputs: Inputs,
  defaultModel: string | null,
): PlannedJob | string {
  const ofKind = models.filter((model) => model.kind === kind);
  if (ofKind.length === 0) return `No ${kind} model is available now. Try again later.`;
  const model = chosenModel(ofKind, args.model, defaultModel, inputs);
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
  return { model, job, inputs, cost };
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
  defaultModel: string | null,
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
    defaultModel: offered.some((model) => model.id === defaultModel) ? defaultModel : null,
    canSetDefault: true,
    models: offered,
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
    if (!media?.available()) return failure(sourceText("error.billing.mediaSignInRequired"));
    if (call.tool === LIST_MEDIA_MODELS_TOOL) return yield* this.#list(media, call);
    if (call.tool === GENERATE_IMAGE_TOOL) {
      const parsed = generateImageToolSchema.safeParse(call.arguments, { reportInput: true });
      if (!parsed.success) return failure(z.prettifyError(parsed.error));
      const { images, ...args } = parsed.data;
      return yield* this.#generate(media, call, "image", args, { first: null, last: null, references: images ?? [] });
    }
    const parsed = generateVideoToolSchema.safeParse(call.arguments, { reportInput: true });
    if (!parsed.success) return failure(z.prettifyError(parsed.error));
    const { firstFrame, lastFrame, images, ...args } = parsed.data;
    return yield* this.#generate(media, call, "video", args, {
      first: firstFrame ?? null,
      last: lastFrame ?? null,
      references: images ?? [],
    });
  }).bind(this);

  #list = Effect.fn("CreditMediaTools.list")(function* (
    this: CreditMediaTools,
    media: CreditMediaWorkflows,
    call: CreditMediaToolCall,
  ) {
    const parsed = listMediaModelsToolSchema.safeParse(call.arguments ?? {}, { reportInput: true });
    if (!parsed.success) return failure(z.prettifyError(parsed.error));
    const kind = parsed.data.kind;
    const [models, balance] = yield* Effect.all([media.models(), media.credits()], { concurrency: "unbounded" });
    return openBotToolResult({
      balance: balance?.available ?? null,
      agentsCanUseCredits: this.#options.agentsAllowed(),
      askAboveCredits: this.#options.approvalCredits(),
      defaultModels: { image: this.#options.defaultModel("image"), video: this.#options.defaultModel("video") },
      models: models.filter((model) => kind === undefined || model.kind === kind).map(listedModel),
    });
  });

  #generate = Effect.fn("CreditMediaTools.generate")(function* (
    this: CreditMediaTools,
    media: CreditMediaWorkflows,
    call: CreditMediaToolCall,
    kind: CreditMediaGenerationKind,
    args: JobArguments,
    inputs: Inputs,
  ) {
    const models = yield* media.models();
    const defaultModel = this.#options.defaultModel(kind);
    const first = plannedJob(models, kind, args, inputs, defaultModel);
    if (typeof first === "string") return failure(first);
    const held = yield* this.#holdUntilFunded(media, call, kind, first.cost);
    if (held) return failure(held);
    const roles = inputRoles(inputs);
    const read = yield* Effect.result(call.readInputs(roles.map(({ path }) => path)));
    if (read._tag === "Failure") return failure(read.failure.message);
    const files = read.success;
    let planned = first;
    if (first.cost > this.#options.approvalCredits()) {
      const name = listedModel(first.model).name;
      const reason =
        kind === "image"
          ? sourceText("status.agent.creditImageApproval", { model: name, credits: first.cost })
          : sourceText("status.agent.creditVideoApproval", { model: name, credits: first.cost });
      const approval = yield* call.approve(reason, approvalOffer(models, kind, first, defaultModel));
      if (!approval.accepted) return failure(sourceText("error.agent.creditMediaDeclined"));
      if (approval.choice) {
        const chosen = plannedJob(models, kind, argumentsOf(args.prompt, approval.choice), inputs, defaultModel);
        if (typeof chosen === "string") return failure(chosen);
        const chosenFunded = chosen.cost > first.cost ? yield* this.#funded(media, chosen) : null;
        if (chosenFunded) return failure(chosenFunded);
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
    const delivery = yield* this.#deliver(media, call, kind, planned, readInput, roles).pipe(
      Effect.forkIn(this.#options.scope(), { startImmediately: true }),
    );
    return yield* Fiber.join(delivery);
  });

  #deliver = Effect.fn("CreditMediaTools.deliver")(function* (
    this: CreditMediaTools,
    media: CreditMediaWorkflows,
    call: CreditMediaToolCall,
    kind: CreditMediaGenerationKind,
    planned: PlannedJob,
    readInput: CreditMediaInputRead,
    roles: readonly InputRole[],
  ) {
    const made = yield* Effect.result(
      media.make(readInput, {
        jobId: randomUUID(),
        model: planned.model,
        job: planned.job,
        images: roles.map(({ role }, index) => ({ role, attachmentId: String(index) })),
      }),
    );
    if (made._tag === "Failure") return failure(made.failure.message);
    const { bytes, mimeType, credits } = made.success;
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
    if (shown._tag === "Failure") return failure(sourceText("error.agent.creditMediaNotSaved"));
    const file = shown.success === null ? {} : { file: shown.success };
    if (kind === "image") return this.#imageResult(planned, credits, bytes, size, file);
    return openBotToolResult({
      status: "shown",
      model: planned.model.id,
      credits,
      duration: planned.job.duration,
      resolution: planned.job.resolution,
      ...file,
    });
  });

  #blocked = Effect.fn("CreditMediaTools.blocked")(function* (
    this: CreditMediaTools,
    media: CreditMediaWorkflows,
    cost: number,
  ) {
    if (!this.#options.agentsAllowed()) return { reason: "agentsOff", balance: null } satisfies Blocked;
    const balance = yield* media.credits();
    if (!balance || cost <= balance.available) return null;
    return { reason: "balance", balance: balance.available } satisfies Blocked;
  });

  #holdUntilFunded = Effect.fn("CreditMediaTools.holdUntilFunded")(function* (
    this: CreditMediaTools,
    media: CreditMediaWorkflows,
    call: CreditMediaToolCall,
    kind: CreditMediaGenerationKind,
    cost: number,
  ) {
    const blocked = yield* this.#blocked(media, cost);
    if (!blocked) return null;
    if (!this.#options.askWhenBlocked() || this.#options.asksMuted(call.requesters))
      return `${blockedText(blocked, cost)} The user turned off credit requests, so OpenBot did not ask. ${NOT_AGAIN} Tell the user once, in a few words, that you skipped this step.`;
    const reason =
      blocked.reason === "agentsOff"
        ? sourceText("status.agent.creditsHoldAgentsOff")
        : sourceText("status.agent.creditsHoldBalance", { credits: cost, balance: blocked.balance ?? 0 });
    const wallet: CreditsHoldWallet = {
      agentsAllowed: () => this.#options.agentsAllowed(),
      enableAgents: () => this.#options.enableAgents(),
      balance: () => media.credits().pipe(Effect.map((balance) => balance?.available ?? null)),
    };
    const answer = yield* call.hold(reason, { call: { kind, cost }, balance: blocked.balance, wallet });
    if (answer.action === "continue") return null;
    if (answer.action === "skip") return `The user skipped this step. ${NOT_AGAIN}`;
    const person = answer.responder?.person ?? null;
    yield* this.#options.muteAsks(person).pipe(Effect.ignore);
    return `The user skipped this step and asked OpenBot not to ask about credits again. ${NOT_AGAIN}`;
  });

  #funded = Effect.fn("CreditMediaTools.funded")(function* (media: CreditMediaWorkflows, planned: PlannedJob) {
    const balance = yield* media.credits();
    if (!balance || planned.cost <= balance.available) return null;
    return `This costs ${planned.cost} credits, and the balance is ${balance.available}. Tell the user to add credits in Settings > Credits. Nothing was spent.`;
  });

  #imageResult(
    planned: PlannedJob,
    credits: number,
    bytes: Uint8Array,
    size: { width: number; height: number } | null,
    file: { file?: string },
  ): DynamicToolResult {
    const summary = { status: "shown", model: planned.model.id, credits, ...(size ?? {}), ...file };
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
