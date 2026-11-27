import {
  CREDIT_CLIP_SECONDS,
  CREDIT_ESTIMATE_SPECS,
  CREDIT_MODEL_COSTS,
  type CreditEstimate,
  type CreditModelCost,
  creditCharge,
  creditEstimates,
  creditModelMakerNamed,
  isCreditAmount,
} from "./credits";
import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "./runtime-values";

export const CREDIT_MEDIA_KINDS = ["image", "video"] as const;
export type CreditMediaGenerationKind = (typeof CREDIT_MEDIA_KINDS)[number];
export const CREDIT_MEDIA_PREFERRED_MODELS: Readonly<Record<CreditMediaGenerationKind, readonly string[]>> = {
  image: ["gpt-image-2.6"],
  video: ["magi-2", "seedance-2.5"],
};
export const CREDIT_MEDIA_PRICE_UNITS = ["item", "second"] as const;
export type CreditMediaPriceUnit = (typeof CREDIT_MEDIA_PRICE_UNITS)[number];
export const CREDIT_MEDIA_JOB_STATUSES = ["queued", "processing", "completed", "failed", "canceled"] as const;
export type CreditMediaJobStatus = (typeof CREDIT_MEDIA_JOB_STATUSES)[number];
export const CREDIT_MEDIA_FAILURES = ["refused", "failed", "canceled", "expired"] as const;
export type CreditMediaFailure = (typeof CREDIT_MEDIA_FAILURES)[number];
export const CREDIT_MEDIA_FAILURE_REASONS = ["content_policy"] as const;
export type CreditMediaFailureReason = (typeof CREDIT_MEDIA_FAILURE_REASONS)[number];
export const CREDIT_MEDIA_INPUT_ROLES = ["first", "last", "reference"] as const;
export type CreditMediaInputRole = (typeof CREDIT_MEDIA_INPUT_ROLES)[number];
export const CREDIT_MEDIA_WALLETS = ["personal", "server"] as const;
export type CreditMediaWallet = (typeof CREDIT_MEDIA_WALLETS)[number];

export const CREDIT_MEDIA_HOST_HEADER = "X-OpenBot-Host";
export const CREDIT_MEDIA_HOST_TOKEN_HEADER = "X-OpenBot-Host-Token";
export const CREDIT_MEDIA_REQUEST_PART = "request";
export const CREDIT_MEDIA_INPUT_LIMIT_BYTES = 7 * 1024 * 1024;
export const CREDIT_MEDIA_INPUTS_LIMIT_BYTES = 14 * 1024 * 1024;
export const CREDIT_MEDIA_PROMPT_LIMIT = 4_000;
export const CREDIT_MEDIA_REFERENCE_LIMIT = 8;
export const CREDIT_MEDIA_COUNT_LIMIT = 4;
export const CREDIT_MEDIA_INPUT_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const CREDIT_MEDIA_REQUEST_PROBLEMS = [
  "model",
  "prompt",
  "aspect",
  "resolution",
  "duration",
  "count",
  "audio",
] as const;
export type CreditMediaRequestProblem = (typeof CREDIT_MEDIA_REQUEST_PROBLEMS)[number];

const MODEL_ID = /^[a-z0-9][a-z0-9.-]{0,79}$/;
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SPEC_VALUE = /^[A-Za-z0-9:.]{1,16}$/;

export interface CreditMediaPrice {
  resolution: string | null;
  unit: CreditMediaPriceUnit;
  credits: number;
  silentCredits: number | null;
}

export interface CreditMediaModel {
  id: string;
  kind: CreditMediaGenerationKind;
  name: string;
  maker: string;
  variant: string | null;
  aspects: readonly string[];
  defaultAspect: string | null;
  resolutions: readonly string[];
  defaultResolution: string | null;
  durations: readonly number[];
  defaultDuration: number | null;
  frames: 0 | 1 | 2;
  references: number;
  audio: boolean;
  maxCount: number;
  promptRequired: boolean;
  prices: readonly CreditMediaPrice[];
  welcome?: true;
}

export interface CreditMediaUnavailableModel {
  id: string;
  kind: CreditMediaGenerationKind;
  name: string;
  variant: string | null;
}

export interface CreditMediaCatalog {
  models: readonly CreditMediaModel[];
  unavailable?: readonly CreditMediaUnavailableModel[];
}

export interface CreditMediaJobRequest {
  jobId: string;
  model: string;
  prompt: string;
  aspect: string | null;
  resolution: string | null;
  duration: number | null;
  count: number;
  audio: boolean;
}

export interface CreditMediaOutput {
  index: number;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

export interface CreditMediaJob {
  jobId: string;
  model: string;
  status: CreditMediaJobStatus;
  credits: number;
  pollAfterSeconds: number;
  outputs: readonly CreditMediaOutput[];
  failure: CreditMediaFailure | null;
  reason: CreditMediaFailureReason | null;
}

export interface CreditMediaBalance {
  wallet: CreditMediaWallet;
  available: number;
  welcome?: number;
}

export interface CreditMediaCostInput {
  resolution: string | null;
  duration: number | null;
  count: number;
  audio: boolean;
}

export function isCreditMediaModelId(value: unknown): value is string {
  return isString(value) && MODEL_ID.test(value);
}

export function isCreditMediaJobId(value: unknown): value is string {
  return isString(value) && JOB_ID.test(value);
}

export function isCreditMediaSpecValue(value: unknown): value is string {
  return isString(value) && SPEC_VALUE.test(value);
}

export function creditMediaPrice(model: CreditMediaModel, resolution: string | null): CreditMediaPrice | null {
  return (
    model.prices.find((price) => price.resolution === resolution) ??
    model.prices.find((price) => price.resolution === null) ??
    null
  );
}

export function creditMediaCost(model: CreditMediaModel, input: CreditMediaCostInput): number | null {
  const price = creditMediaPrice(model, input.resolution ?? model.defaultResolution);
  if (!price) return null;
  const units = price.unit === "second" ? (input.duration ?? model.defaultDuration ?? 0) : 1;
  const silent = model.audio && !input.audio && price.silentCredits !== null;
  const perUnit = silent && price.silentCredits !== null ? price.silentCredits : price.credits;
  const total = perUnit * units * Math.max(1, input.count);
  if (!Number.isFinite(total) || total <= 0) return null;
  return creditCharge(total);
}

export function creditMediaShownCredits(model: CreditMediaModel): number | null {
  const price = creditMediaPrice(model, model.defaultResolution);
  if (!price) return null;
  const perUnit = model.audio && price.silentCredits !== null ? price.silentCredits : price.credits;
  return price.unit === "second" ? creditCharge(perUnit * CREDIT_CLIP_SECONDS) : perUnit;
}

function liveModelCost(model: CreditMediaModel): CreditModelCost | null {
  const maker = creditModelMakerNamed(model.maker);
  const credits = creditMediaShownCredits(model);
  if (maker === undefined || credits === null) return null;
  const cost: CreditModelCost = {
    modelId: model.id,
    name: model.name,
    maker,
    kind: model.kind,
    unit: model.kind === "video" ? "clip" : "image",
    credits,
  };
  return model.variant === null ? cost : { ...cost, variant: model.variant };
}

export function creditModelCostsLive(models: readonly CreditMediaModel[]): CreditModelCost[] {
  const live = new Map(models.map((model) => [model.id, model]));
  const known = new Set(CREDIT_MODEL_COSTS.map((cost) => cost.modelId));
  const listed = CREDIT_MODEL_COSTS.map((cost) => {
    const model = live.get(cost.modelId);
    const credits = model ? creditMediaShownCredits(model) : null;
    if (!model || credits === null) return cost;
    return model.variant === null ? { ...cost, credits } : { ...cost, credits, variant: model.variant };
  });
  const added = models.flatMap((model) => {
    if (known.has(model.id)) return [];
    const cost = liveModelCost(model);
    return cost ? [cost] : [];
  });
  return [...listed, ...added];
}

export function creditEstimatesLive(models: readonly CreditMediaModel[]): CreditEstimate[] {
  const live = new Map(models.map((model) => [model.id, model]));
  return creditEstimates().flatMap((estimate) => {
    const model = live.get(estimate.model.modelId);
    if (!model) return [];
    const spec = CREDIT_ESTIMATE_SPECS[estimate.model.modelId];
    if (!spec || !model.resolutions.includes(spec.resolution)) return [estimate];
    const charge = creditMediaCost(model, {
      resolution: spec.resolution,
      duration: model.kind === "video" ? CREDIT_CLIP_SECONDS : null,
      count: 1,
      audio: false,
    });
    return [charge === null ? estimate : { ...estimate, charge }];
  });
}

export function creditMediaRequestProblem(
  model: CreditMediaModel,
  request: CreditMediaJobRequest,
): CreditMediaRequestProblem | null {
  if (request.model !== model.id) return "model";
  if (model.promptRequired && request.prompt.trim() === "") return "prompt";
  if (request.aspect !== null ? !model.aspects.includes(request.aspect) : false) return "aspect";
  if (request.resolution !== null ? !model.resolutions.includes(request.resolution) : false) return "resolution";
  if (model.kind === "video" && request.duration !== null && !model.durations.includes(request.duration))
    return "duration";
  if (model.kind === "image" && request.duration !== null) return "duration";
  if (request.count > model.maxCount) return "count";
  if (request.audio && !model.audio) return "audio";
  return null;
}

export function creditMediaRequiredInput(model: CreditMediaModel): CreditMediaInputRole | null {
  if (model.promptRequired) return null;
  return model.kind === "video" && model.frames > 0 ? "first" : "reference";
}

function isPositiveCredits(value: unknown): value is number {
  return isNumber(value) && Number.isFinite(value) && value > 0;
}

function parsePrice(value: unknown): CreditMediaPrice | null {
  if (!isDynamicRecord(value)) return null;
  const resolution =
    value.resolution === null ? null : isCreditMediaSpecValue(value.resolution) ? value.resolution : undefined;
  if (resolution === undefined || !isOneOf(CREDIT_MEDIA_PRICE_UNITS, value.unit)) return null;
  if (!isPositiveCredits(value.credits)) return null;
  const silentCredits = value.silentCredits ?? null;
  if (silentCredits !== null && !(isPositiveCredits(silentCredits) && silentCredits <= value.credits)) return null;
  return { resolution, unit: value.unit, credits: value.credits, silentCredits };
}

function specList(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || !value.every(isCreditMediaSpecValue)) return null;
  return value;
}

function durationList(value: unknown): readonly number[] | null {
  if (!Array.isArray(value)) return null;
  const durations = value.filter((item): item is number => isNumber(item) && Number.isSafeInteger(item) && item > 0);
  return durations.length === value.length ? durations : null;
}

function nullableText(value: unknown, limit: number): string | null | undefined {
  if (value === null) return null;
  return isString(value) && value.length > 0 && value.length <= limit ? value : undefined;
}

function nullableSpec(value: unknown): string | null | undefined {
  if (value === null) return null;
  return isCreditMediaSpecValue(value) ? value : undefined;
}

function boundedInteger(value: unknown, min: number, max: number): number | null {
  return isNumber(value) && Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}

export function parseCreditMediaModel(value: unknown): CreditMediaModel | null {
  if (!isDynamicRecord(value) || !isCreditMediaModelId(value.id) || !isOneOf(CREDIT_MEDIA_KINDS, value.kind))
    return null;
  if (!isString(value.name) || value.name.length === 0 || value.name.length > 120) return null;
  if (!isString(value.maker) || value.maker.length === 0 || value.maker.length > 80) return null;
  const variant = nullableText(value.variant, 40);
  const aspects = specList(value.aspects);
  const resolutions = specList(value.resolutions);
  const durations = durationList(value.durations);
  const defaultAspect = nullableSpec(value.defaultAspect);
  const defaultResolution = nullableSpec(value.defaultResolution);
  const defaultDuration = value.defaultDuration === null ? null : boundedInteger(value.defaultDuration, 1, 600);
  const frames = boundedInteger(value.frames, 0, 2);
  const references = boundedInteger(value.references, 0, CREDIT_MEDIA_REFERENCE_LIMIT);
  const maxCount = boundedInteger(value.maxCount, 1, CREDIT_MEDIA_COUNT_LIMIT);
  if (variant === undefined || !aspects || !resolutions || !durations) return null;
  if (defaultAspect === undefined || defaultResolution === undefined) return null;
  if (frames === null || references === null || maxCount === null) return null;
  if (value.defaultDuration !== null && defaultDuration === null) return null;
  if (!isBoolean(value.audio) || !isBoolean(value.promptRequired) || !Array.isArray(value.prices)) return null;
  const prices = value.prices.map(parsePrice).filter((price): price is CreditMediaPrice => price !== null);
  if (prices.length === 0 || prices.length !== value.prices.length) return null;
  const model: CreditMediaModel = {
    id: value.id,
    kind: value.kind,
    name: value.name,
    maker: value.maker,
    variant,
    aspects,
    defaultAspect,
    resolutions,
    defaultResolution,
    durations,
    defaultDuration,
    frames: frames === 0 ? 0 : frames === 1 ? 1 : 2,
    references,
    audio: value.audio,
    maxCount,
    promptRequired: value.promptRequired,
    prices,
  };
  if (value.welcome === true) model.welcome = true;
  return model;
}

function parseUnavailableModel(value: unknown): CreditMediaUnavailableModel | null {
  if (!isDynamicRecord(value) || !isCreditMediaModelId(value.id) || !isOneOf(CREDIT_MEDIA_KINDS, value.kind))
    return null;
  if (!isString(value.name) || value.name.length === 0 || value.name.length > 120) return null;
  const variant = nullableText(value.variant, 40);
  if (variant === undefined) return null;
  return { id: value.id, kind: value.kind, name: value.name, variant };
}

export function parseCreditMediaCatalog(value: unknown): CreditMediaCatalog | null {
  if (!isDynamicRecord(value) || !Array.isArray(value.models)) return null;
  const models = value.models.map(parseCreditMediaModel).filter((model): model is CreditMediaModel => model !== null);
  if (!Array.isArray(value.unavailable)) return { models };
  return {
    models,
    unavailable: value.unavailable
      .map(parseUnavailableModel)
      .filter((model): model is CreditMediaUnavailableModel => model !== null),
  };
}

export function parseCreditMediaJobRequest(value: unknown): CreditMediaJobRequest | null {
  if (!isDynamicRecord(value) || !isCreditMediaJobId(value.jobId) || !isCreditMediaModelId(value.model)) return null;
  if (!isString(value.prompt) || value.prompt.length > CREDIT_MEDIA_PROMPT_LIMIT) return null;
  const aspect = nullableSpec(value.aspect ?? null);
  const resolution = nullableSpec(value.resolution ?? null);
  const duration =
    value.duration === null || value.duration === undefined ? null : boundedInteger(value.duration, 1, 600);
  const count = value.count === undefined ? 1 : boundedInteger(value.count, 1, CREDIT_MEDIA_COUNT_LIMIT);
  if (aspect === undefined || resolution === undefined || count === null) return null;
  if (value.duration !== null && value.duration !== undefined && duration === null) return null;
  const audio = value.audio === undefined ? false : value.audio;
  if (!isBoolean(audio)) return null;
  return { jobId: value.jobId, model: value.model, prompt: value.prompt, aspect, resolution, duration, count, audio };
}

function parseOutput(value: unknown): CreditMediaOutput | null {
  if (!isDynamicRecord(value)) return null;
  const index = boundedInteger(value.index, 0, 63);
  if (index === null || !isString(value.mimeType) || value.mimeType.length > 100) return null;
  const optional = (item: unknown) => (isNumber(item) && Number.isFinite(item) && item >= 0 ? item : null);
  return {
    index,
    mimeType: value.mimeType,
    width: optional(value.width),
    height: optional(value.height),
    durationMs: optional(value.durationMs),
  };
}

export function parseCreditMediaJob(value: unknown): CreditMediaJob | null {
  if (!isDynamicRecord(value) || !isCreditMediaJobId(value.jobId) || !isCreditMediaModelId(value.model)) return null;
  if (!isOneOf(CREDIT_MEDIA_JOB_STATUSES, value.status) || !Array.isArray(value.outputs)) return null;
  const credits = isCreditAmount(value.credits) ? value.credits : null;
  const pollAfterSeconds = boundedInteger(value.pollAfterSeconds, 0, 3_600);
  const failure =
    value.failure === null ? null : isOneOf(CREDIT_MEDIA_FAILURES, value.failure) ? value.failure : undefined;
  if (credits === null || pollAfterSeconds === null || failure === undefined) return null;
  const outputs = value.outputs.map(parseOutput).filter((output): output is CreditMediaOutput => output !== null);
  const reason = isOneOf(CREDIT_MEDIA_FAILURE_REASONS, value.reason) ? value.reason : null;
  return {
    jobId: value.jobId,
    model: value.model,
    status: value.status,
    credits,
    pollAfterSeconds,
    outputs,
    failure,
    reason,
  };
}

export function parseCreditMediaBalance(value: unknown): CreditMediaBalance | null {
  if (!isDynamicRecord(value) || !isOneOf(CREDIT_MEDIA_WALLETS, value.wallet)) return null;
  const available = isCreditAmount(value.available) ? value.available : null;
  if (available === null) return null;
  const balance: CreditMediaBalance = { wallet: value.wallet, available };
  if (isCreditAmount(value.welcome) && value.welcome > 0) balance.welcome = Math.min(value.welcome, available);
  return balance;
}

export function creditMediaSpendable(balance: Pick<CreditMediaBalance, "available" | "welcome">, welcome: boolean) {
  const kept = balance.welcome ?? 0;
  const paid = Math.max(0, balance.available - kept);
  return welcome ? Math.max(kept, paid) : paid;
}
