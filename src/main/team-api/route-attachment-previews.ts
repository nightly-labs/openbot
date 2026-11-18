import { basename, parse } from "node:path";
import {
  ATTACHMENT_PREVIEW_ROUTE,
  ATTACHMENT_PREVIEW_SIZES,
  type AttachmentPreviewSize,
} from "@openbot/contracts/team-protocol/attachment-previews-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAttachmentPreviews, TeamApiMailbox } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, stringField } from "./request-helpers";

export interface AttachmentPreviewRouteDependencies {
  mailbox: TeamApiMailbox;
  previews: TeamApiAttachmentPreviews | undefined;
}

function isPreviewSize(value: unknown): value is AttachmentPreviewSize {
  return ATTACHMENT_PREVIEW_SIZES.some((size) => size === value);
}

/**
 * `attachment-previews-v1`: a smaller copy of a JPEG or PNG attachment, for a phone. A member gets the
 * copy of each attachment that `GET /v1/attachments/:id` gives them, with the same lookup. The copy is
 * an attachment response, so the WebRTC host peer sends it as a file, as it sends the original.
 */
export async function routeAttachmentPreviews(
  context: TeamApiRequestContext,
  { mailbox, previews }: AttachmentPreviewRouteDependencies,
): Promise<RouteOutcome> {
  const { method, url, request, response } = context;
  if (method !== "POST" || url.pathname !== ATTACHMENT_PREVIEW_ROUTE) return "unmatched";
  // `readJson` has already run the body through the attachment-previews wire codec.
  const body = await readJson(request);
  const attachmentId = stringField(body, "attachmentId");
  if (!isPreviewSize(body.size)) throw new HttpError(400, "size is required.");
  // A host without the maker does not advertise the capability. The client then loads the file itself.
  if (!previews) throw new HttpError(415, sourceText("error.team.attachmentPreviewUnsupported"));
  const attachment = await runCauseEffect(mailbox.resolveAttachment(attachmentId));
  if (!attachment) throw new HttpError(404, sourceText("error.team.attachmentNotFound"));
  const preview = await runCauseEffect(previews.preview({ id: attachmentId, path: attachment.path }, body.size));
  if (!preview) throw new HttpError(415, sourceText("error.team.attachmentPreviewUnsupported"));
  const extension = preview.mimeType === "image/png" ? "png" : "jpg";
  const name = `${parse(attachment.name || basename(attachment.path)).name || "picture"}.${extension}`;
  response.writeHead(200, {
    "Content-Type": preview.mimeType,
    "Content-Length": String(preview.bytes.byteLength),
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    "X-Content-Type-Options": "nosniff",
  });
  response.end(preview.bytes);
  return "handled";
}
