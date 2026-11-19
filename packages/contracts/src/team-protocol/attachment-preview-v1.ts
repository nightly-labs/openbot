// Frozen optional attachment-preview-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: `GET
// /v1/attachments/<id>/preview` answers a small copy of an image attachment, for a card that shows the
// picture small, such as a step on the Workflows canvas. The member reads it with the same access as
// the file itself (`GET /v1/attachments/<id>`). The copy has the shape of the file, and its longest side
// is at most `ATTACHMENT_PREVIEW_EDGE` pixels. It is a JPEG, or a PNG when the picture has clear pixels.
// The `Content-Type` header names the type. When the host makes no smaller copy of a small file (a
// picture that is already small, or a type that it cannot decode), it answers the file itself, with its
// own type. A larger file with no copy, such as a large WebP or GIF file, and a file that is not an
// image, get 415: the client reads the whole file, at the pace of other file downloads. An attachment id names bytes that do not change, so a client can
// keep the answer as long as it keeps the file. A client asks for it only from a host that sends this
// capability; without it, the client reads the whole file, as before. Over WebRTC the route is a side
// route (`side-routes.ts`): its request frame has no body, and an error answer is the error envelope.
// The answer is always a file, so a JSON success answer is refused. Widening any of it needs a second
// capability string.
import { type AdminDecoder, adminRoute, type OptionalRouteCodec } from "./admin-wire";

export const ATTACHMENT_PREVIEW_CAPABILITY = "attachment-preview-v1";

/** The longest side, in pixels, of a preview. */
export const ATTACHMENT_PREVIEW_EDGE = 768;

/** The preview route, for each method. Only `GET` is served. */
export function isAttachmentPreviewRoute(path: string): boolean {
  return /^\/v1\/attachments\/[^/]+\/preview$/u.test(new URL(path, "http://openbot.invalid").pathname);
}

/** The desktop sends no body and the web client sends `{}`. Anything else is not accepted. */
const noBody: AdminDecoder = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) return null;
  throw new Error("Invalid attachment preview request.");
};

/** A preview is sent as a file, never as JSON. */
const fileOnly: AdminDecoder = () => {
  throw new Error("Invalid attachment preview response.");
};

export const ATTACHMENT_PREVIEW_CODEC: OptionalRouteCodec = adminRoute(noBody, fileOnly);
