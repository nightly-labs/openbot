import {
  CREDIT_MEDIA_KINDS,
  CREDIT_MEDIA_PROMPT_LIMIT,
  type CreditMediaGenerationKind,
  type CreditMediaModel,
  isCreditMediaModelId,
  isCreditMediaSpecValue,
  parseCreditMediaModel,
} from "./credit-media";
import { isIdentifier, isRequestId } from "./ipc-bounded-values";
import { isBoolean, isDynamicRecord, isOneOf, isString } from "./runtime-values";

export const MEDIA_APPROVAL_MODEL_LIMIT = 200;

export interface MediaApprovalChoice {
  model: string;
  aspect: string | null;
  resolution: string | null;
  duration: number | null;
  audio: boolean;
}

export interface MediaApprovalOffer {
  kind: CreditMediaGenerationKind;
  prompt: string;
  agentModel: string;
  choice: MediaApprovalChoice;
  defaultModel: string | null;
  canSetDefault: boolean;
  models: CreditMediaModel[];
  balance?: MediaApprovalBalance;
}

export interface MediaApprovalBalance {
  available: number;
  welcome: number;
}

export interface ReadMediaApprovalInput {
  agentId: string;
  requestId: string | number;
}

export interface RespondToMediaApprovalInput {
  agentId: string;
  requestId: string | number;
  choice: MediaApprovalChoice;
}

function nullableSpec(value: unknown): string | null | undefined {
  if (value === null) return null;
  return isCreditMediaSpecValue(value) ? value : undefined;
}

function nullableDuration(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 600 ? value : undefined;
}

export function parseMediaApprovalChoice(value: unknown): MediaApprovalChoice | null {
  if (!isDynamicRecord(value) || !isCreditMediaModelId(value.model) || !isBoolean(value.audio)) return null;
  const aspect = nullableSpec(value.aspect);
  const resolution = nullableSpec(value.resolution);
  const duration = nullableDuration(value.duration);
  if (aspect === undefined || resolution === undefined || duration === undefined) return null;
  return { model: value.model, aspect, resolution, duration, audio: value.audio };
}

export function parseMediaApprovalOffer(value: unknown): MediaApprovalOffer | null {
  if (!isDynamicRecord(value) || !isOneOf(CREDIT_MEDIA_KINDS, value.kind)) return null;
  if (!isCreditMediaModelId(value.agentModel) || !isBoolean(value.canSetDefault)) return null;
  if (!isString(value.prompt) || value.prompt.length > CREDIT_MEDIA_PROMPT_LIMIT) return null;
  if (value.defaultModel !== null && !isCreditMediaModelId(value.defaultModel)) return null;
  const choice = parseMediaApprovalChoice(value.choice);
  if (!choice || !Array.isArray(value.models) || value.models.length > MEDIA_APPROVAL_MODEL_LIMIT) return null;
  const kind = value.kind;
  const models = value.models
    .map(parseCreditMediaModel)
    .filter((model): model is CreditMediaModel => model !== null && model.kind === kind);
  if (!models.some((model) => model.id === choice.model)) return null;
  const balance = parseMediaApprovalBalance(value.balance);
  return {
    kind,
    prompt: value.prompt,
    agentModel: value.agentModel,
    choice,
    defaultModel: value.defaultModel,
    canSetDefault: value.canSetDefault,
    models,
    ...(balance ? { balance } : {}),
  };
}

function parseMediaApprovalBalance(value: unknown): MediaApprovalBalance | null {
  if (!isDynamicRecord(value) || !isCreditsHoldAmount(value.available) || !isCreditsHoldAmount(value.welcome))
    return null;
  return { available: value.available, welcome: Math.min(value.welcome, value.available) };
}

export function parseReadMediaApprovalInput(value: unknown): ReadMediaApprovalInput {
  if (!isDynamicRecord(value) || !isIdentifier(value.agentId) || !isRequestId(value.requestId))
    throw new Error("Invalid media approval request.");
  return { agentId: value.agentId, requestId: value.requestId };
}

export function parseRespondToMediaApprovalInput(value: unknown): RespondToMediaApprovalInput {
  const { agentId, requestId } = parseReadMediaApprovalInput(value);
  const choice = isDynamicRecord(value) ? parseMediaApprovalChoice(value.choice) : null;
  if (!choice) throw new Error("Invalid media approval choice.");
  return { agentId, requestId, choice };
}

export function decodeMediaApprovalOfferResult(value: unknown): MediaApprovalOffer | null {
  if (value === null) return null;
  const offer = parseMediaApprovalOffer(value);
  if (!offer) throw new Error("Invalid media approval.");
  return offer;
}

export const CREDITS_HOLD_REASONS = ["balance", "agentsOff"] as const;
export type CreditsHoldReason = (typeof CREDITS_HOLD_REASONS)[number];

export const CREDITS_HOLD_ACTIONS = ["continue", "enable", "skip", "mute"] as const;
export type CreditsHoldAction = (typeof CREDITS_HOLD_ACTIONS)[number];

export const CREDITS_HOLD_CALL_LIMIT = 1_000;
export const CREDITS_HOLD_AMOUNT_LIMIT = 1_000_000_000;

export interface CreditsHold {
  reason: CreditsHoldReason;
  images: number;
  videos: number;
  cost: number;
  balance: number | null;
  canEnable: boolean;
}

export interface MediaApprovalRead {
  media: MediaApprovalOffer | null;
  hold: CreditsHold | null;
}

export interface RespondToCreditsHoldInput {
  agentId: string;
  requestId: string | number;
  action: CreditsHoldAction;
}

export function isCreditsHoldAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= CREDITS_HOLD_AMOUNT_LIMIT;
}

export function isCreditsHoldCalls(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= CREDITS_HOLD_CALL_LIMIT;
}

export function parseCreditsHold(value: unknown): CreditsHold | null {
  if (!isDynamicRecord(value) || !isOneOf(CREDITS_HOLD_REASONS, value.reason)) return null;
  if (!isCreditsHoldCalls(value.images) || !isCreditsHoldCalls(value.videos) || value.images + value.videos === 0)
    return null;
  if (!isCreditsHoldAmount(value.cost) || !isBoolean(value.canEnable)) return null;
  if (value.balance !== null && !isCreditsHoldAmount(value.balance)) return null;
  return {
    reason: value.reason,
    images: value.images,
    videos: value.videos,
    cost: value.cost,
    balance: value.balance,
    canEnable: value.canEnable,
  };
}

export function decodeCreditsHoldResult(value: unknown): CreditsHold | null {
  if (value === null) return null;
  const hold = parseCreditsHold(value);
  if (!hold) throw new Error("Invalid credits hold.");
  return hold;
}

export function decodeMediaApprovalRead(value: unknown): MediaApprovalRead {
  if (!isDynamicRecord(value)) throw new Error("Invalid media approval.");
  return {
    media: decodeMediaApprovalOfferResult(value.media ?? null),
    hold: decodeCreditsHoldResult(value.hold ?? null),
  };
}

export function parseRespondToCreditsHoldInput(value: unknown): RespondToCreditsHoldInput {
  const { agentId, requestId } = parseReadMediaApprovalInput(value);
  const action = isDynamicRecord(value) ? value.action : undefined;
  if (!isOneOf(CREDITS_HOLD_ACTIONS, action)) throw new Error("Invalid credits hold action.");
  return { agentId, requestId, action };
}

export function decodeCreditsAskMuted(value: unknown): { muted: boolean } {
  return parseCreditsAskMutedInput(value);
}

export function parseCreditsAskMutedInput(value: unknown): { muted: boolean } {
  if (!isDynamicRecord(value) || !isBoolean(value.muted)) throw new Error("Invalid credits ask setting.");
  return { muted: value.muted };
}
