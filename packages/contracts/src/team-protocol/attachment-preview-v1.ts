import { type AdminDecoder, adminRoute, type OptionalRouteCodec } from "./admin-wire";

export const ATTACHMENT_PREVIEW_CAPABILITY = "attachment-preview-v1";

export const ATTACHMENT_PREVIEW_EDGE = 768;

export function isAttachmentPreviewRoute(path: string): boolean {
  return /^\/v1\/attachments\/[^/]+\/preview$/u.test(new URL(path, "http://openbot.invalid").pathname);
}

const noBody: AdminDecoder = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) return null;
  throw new Error("Invalid attachment preview request.");
};

const fileOnly: AdminDecoder = () => {
  throw new Error("Invalid attachment preview response.");
};

export const ATTACHMENT_PREVIEW_CODEC: OptionalRouteCodec = adminRoute(noBody, fileOnly);
