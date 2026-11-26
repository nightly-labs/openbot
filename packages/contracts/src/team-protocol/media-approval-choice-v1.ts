import {
  CREDIT_MEDIA_PRICE_UNITS,
  CREDIT_MEDIA_PROMPT_LIMIT,
  isCreditMediaModelId,
  isCreditMediaSpecValue,
} from "../credit-media";
import { isRequestId } from "../ipc-bounded-values";
import {
  CREDITS_HOLD_ACTIONS,
  CREDITS_HOLD_REASONS,
  type CreditsHold,
  decodeCreditsHoldResult,
  decodeMediaApprovalRead,
  isCreditsHoldAmount,
  isCreditsHoldCalls,
  MEDIA_APPROVAL_MODEL_LIMIT,
  type MediaApprovalRead,
} from "../ipc-media-approval";
import { isDynamicRecord } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  boolean,
  count,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";

export const MEDIA_APPROVAL_CHOICE_CAPABILITY = "media-approval-choice-v1";

export const MEDIA_APPROVAL_CHOICE_ROUTES = {
  read: "/v1/agent-approvals/media/read",
  respond: "/v1/agent-approvals/media/respond",
  hold: "/v1/agent-approvals/media/hold",
  muted: "/v1/agent-approvals/media/muted",
  mutedRead: "/v1/agent-approvals/media/muted/read",
} as const;

const requestId: AdminDecoder = (value) => {
  if (!isRequestId(value)) throw new Error("Invalid approval request ID.");
  return value;
};

const modelId: AdminDecoder = (value) => {
  if (!isCreditMediaModelId(value)) throw new Error("Invalid media model.");
  return value;
};

const spec: AdminDecoder = (value) => {
  if (!isCreditMediaSpecValue(value)) throw new Error("Invalid media setting.");
  return value;
};

const seconds: AdminDecoder = (value) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 600)
    throw new Error("Invalid media duration.");
  return value;
};

const credits: AdminDecoder = (value) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error("Invalid media price.");
  return value;
};

const amount: AdminDecoder = (value) => {
  if (!isCreditsHoldAmount(value)) throw new Error("Invalid credits amount.");
  return value;
};

const calls: AdminDecoder = (value) => {
  if (!isCreditsHoldCalls(value)) throw new Error("Invalid credits hold count.");
  return value;
};

const welcomeModel: AdminDecoder = (value) => {
  if (value !== true) throw new Error("Invalid media model.");
  return value;
};

const hold = fields({
  reason: oneOf(...CREDITS_HOLD_REASONS),
  images: calls,
  videos: calls,
  cost: amount,
  balance: nullable(amount),
  canEnable: boolean,
});

const price = fields({
  resolution: nullable(spec),
  unit: oneOf(...CREDIT_MEDIA_PRICE_UNITS),
  credits,
  silentCredits: nullable(credits),
});

const model = fields(
  {
    id: modelId,
    kind: oneOf("image", "video"),
    name: string(120),
    maker: string(80),
    variant: nullable(string(40)),
    aspects: list(spec, 40),
    defaultAspect: nullable(spec),
    resolutions: list(spec, 40),
    defaultResolution: nullable(spec),
    durations: list(seconds, 100),
    defaultDuration: nullable(seconds),
    frames: count,
    references: count,
    audio: boolean,
    maxCount: count,
    promptRequired: boolean,
    prices: list(price, 40),
  },
  { welcome: welcomeModel },
);

const choice = fields({
  model: modelId,
  aspect: nullable(spec),
  resolution: nullable(spec),
  duration: nullable(seconds),
  audio: boolean,
});

const offer = fields(
  {
    kind: oneOf("image", "video"),
    prompt: string(CREDIT_MEDIA_PROMPT_LIMIT),
    agentModel: modelId,
    choice,
    defaultModel: nullable(modelId),
    canSetDefault: boolean,
    models: list(model, MEDIA_APPROVAL_MODEL_LIMIT),
  },
  { balance: fields({ available: amount, welcome: amount }) },
);

export const MEDIA_APPROVAL_CHOICE_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    MEDIA_APPROVAL_CHOICE_ROUTES.read,
    adminRoute(
      fields({ agentId: identifier, requestId }),
      fields({ media: nullable(offer) }, { hold: nullable(hold) }),
    ),
  ],
  [MEDIA_APPROVAL_CHOICE_ROUTES.respond, adminRoute(fields({ agentId: identifier, requestId, choice }), empty)],
  [
    MEDIA_APPROVAL_CHOICE_ROUTES.hold,
    adminRoute(
      fields({ agentId: identifier, requestId, action: oneOf(...CREDITS_HOLD_ACTIONS) }),
      fields({ hold: nullable(hold) }),
    ),
  ],
  [MEDIA_APPROVAL_CHOICE_ROUTES.muted, adminRoute(fields({ muted: boolean }), empty)],
  [MEDIA_APPROVAL_CHOICE_ROUTES.mutedRead, adminRoute(empty, fields({ muted: boolean }))],
]);

export function decodeMediaApprovalReadResponse(value: unknown): MediaApprovalRead {
  return decodeMediaApprovalRead(value);
}

export function decodeCreditsHoldResponse(value: unknown): CreditsHold | null {
  if (!isDynamicRecord(value)) throw new Error("Invalid credits hold.");
  return decodeCreditsHoldResult(value.hold ?? null);
}
