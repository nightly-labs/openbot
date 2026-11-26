import { isCreditMediaModelId } from "../credit-media";
import {
  decodeMediaApprovalCreditsSetting,
  isMediaApprovalCredits,
  type MediaApprovalCreditsSetting,
} from "../ipc-media-approval-credits";
import { type AdminDecoder, adminRoute, boolean, empty, fields, nullable, type OptionalRouteCodec } from "./admin-wire";

export const MEDIA_APPROVAL_CREDITS_CAPABILITY = "media-approval-credits-v1";

export const MEDIA_APPROVAL_CREDITS_ROUTES = {
  settings: "/v1/admin/host/media-approval-credits",
  update: "/v1/admin/host/media-approval-credits/update",
} as const;

const credits: AdminDecoder = (value) => {
  if (!isMediaApprovalCredits(value)) throw new Error("Invalid media approval credits.");
  return value;
};

const model: AdminDecoder = (value) => {
  if (!isCreditMediaModelId(value)) throw new Error("Invalid media model.");
  return value;
};

const snapshot = fields({
  agents: boolean,
  askWhenBlocked: boolean,
  credits,
  imageModel: nullable(model),
  videoModel: nullable(model),
});
const update = fields(
  {},
  { agents: boolean, askWhenBlocked: boolean, credits, imageModel: nullable(model), videoModel: nullable(model) },
);

export const MEDIA_APPROVAL_CREDITS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [MEDIA_APPROVAL_CREDITS_ROUTES.settings, adminRoute(empty, snapshot)],
  [MEDIA_APPROVAL_CREDITS_ROUTES.update, adminRoute(update, snapshot)],
]);

export function decodeMediaApprovalCreditsResponse(value: unknown): MediaApprovalCreditsSetting {
  return decodeMediaApprovalCreditsSetting(value);
}
