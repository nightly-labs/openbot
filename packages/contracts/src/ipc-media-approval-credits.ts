import { type CreditMediaGenerationKind, isCreditMediaModelId } from "./credit-media";
import { isDynamicRecord } from "./runtime-values";

export const MEDIA_APPROVAL_CREDITS_MIN = 0;
export const MEDIA_APPROVAL_CREDITS_MAX = 100_000;

export interface MediaApprovalCreditsSetting {
  agents: boolean;
  askWhenBlocked: boolean;
  credits: number;
  imageModel: string | null;
  videoModel: string | null;
}

export type MediaApprovalCreditsUpdate = Partial<MediaApprovalCreditsSetting>;

export function mediaApprovalDefaultModelUpdate(
  kind: CreditMediaGenerationKind,
  model: string | null,
): MediaApprovalCreditsUpdate {
  return kind === "image" ? { imageModel: model } : { videoModel: model };
}

export const DEFAULT_MEDIA_APPROVAL_CREDITS_SETTING: MediaApprovalCreditsSetting = {
  agents: true,
  askWhenBlocked: true,
  credits: 50,
  imageModel: null,
  videoModel: null,
};

export function isMediaApprovalCredits(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= MEDIA_APPROVAL_CREDITS_MIN &&
    value <= MEDIA_APPROVAL_CREDITS_MAX
  );
}

export function isMediaApprovalDefaultModel(value: unknown): value is string | null {
  return value === null || isCreditMediaModelId(value);
}

function defaultModelOf(value: unknown): string | null | undefined {
  if (value === undefined) return null;
  return isMediaApprovalDefaultModel(value) ? value : undefined;
}

export function parseMediaApprovalCreditsSetting(value: unknown): MediaApprovalCreditsSetting | null {
  if (!isDynamicRecord(value) || !isMediaApprovalCredits(value.credits)) return null;
  const agents = value.agents ?? true;
  if (typeof agents !== "boolean") return null;
  const askWhenBlocked = value.askWhenBlocked ?? true;
  if (typeof askWhenBlocked !== "boolean") return null;
  const imageModel = defaultModelOf(value.imageModel);
  const videoModel = defaultModelOf(value.videoModel);
  if (imageModel === undefined || videoModel === undefined) return null;
  return { agents, askWhenBlocked, credits: value.credits, imageModel, videoModel };
}

export function decodeMediaApprovalCreditsSetting(value: unknown): MediaApprovalCreditsSetting {
  const setting = parseMediaApprovalCreditsSetting(value);
  if (!setting) throw new Error("Invalid media approval credits.");
  return setting;
}

export function parseMediaApprovalCreditsUpdate(value: unknown): MediaApprovalCreditsUpdate | null {
  if (!isDynamicRecord(value)) return null;
  if (value.agents !== undefined && typeof value.agents !== "boolean") return null;
  if (value.askWhenBlocked !== undefined && typeof value.askWhenBlocked !== "boolean") return null;
  if (value.credits !== undefined && !isMediaApprovalCredits(value.credits)) return null;
  if (value.imageModel !== undefined && !isMediaApprovalDefaultModel(value.imageModel)) return null;
  if (value.videoModel !== undefined && !isMediaApprovalDefaultModel(value.videoModel)) return null;
  return {
    ...(value.agents === undefined ? {} : { agents: value.agents }),
    ...(value.askWhenBlocked === undefined ? {} : { askWhenBlocked: value.askWhenBlocked }),
    ...(value.credits === undefined ? {} : { credits: value.credits }),
    ...(value.imageModel === undefined ? {} : { imageModel: value.imageModel }),
    ...(value.videoModel === undefined ? {} : { videoModel: value.videoModel }),
  };
}
