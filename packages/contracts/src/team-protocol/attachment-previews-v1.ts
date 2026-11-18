// Frozen optional attachment-previews-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: a member who can fetch an
// attachment with `GET /v1/attachments/:id` can also ask for a smaller copy of a JPEG or PNG
// attachment. `POST /v1/attachment-previews` takes `{ attachmentId, size }` and answers the copy as an
// attachment, as `GET /v1/attachments/:id` answers the file. `small` is at most 768 pixels on its
// long side, for a grid tile or a chat card; `large` is at most 2048 pixels, for a full-screen view.
// The copy is upright (the EXIF orientation is applied) and has no EXIF data. It is a JPEG, or a PNG
// when the picture has transparency. A picture that is already within the size comes back as a new
// file of the same picture. The host answers 404 for an attachment it does not have, and 415 for a file
// it cannot make a copy of (any type other than JPEG and PNG, or a picture that is too large to
// decode); the client then fetches the file itself. Only the ids and the size name cross the wire as
// JSON. Widening any of it needs a second capability string.
import { adminRoute, empty, fields, identifier, type OptionalRouteCodec, oneOf } from "./admin-wire";

export const ATTACHMENT_PREVIEWS_CAPABILITY = "attachment-previews-v1";

export const ATTACHMENT_PREVIEW_ROUTE = "/v1/attachment-previews";

export const ATTACHMENT_PREVIEW_SIZES = ["small", "large"] as const;
export type AttachmentPreviewSize = (typeof ATTACHMENT_PREVIEW_SIZES)[number];

/** The longest side, in pixels, of each preview size. Released values: do not change one. */
export const ATTACHMENT_PREVIEW_EDGES: Readonly<Record<AttachmentPreviewSize, number>> = {
  small: 768,
  large: 2048,
};

export const ATTACHMENT_PREVIEWS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  // The response is the copy itself, sent as an attachment; only an error envelope is JSON.
  [
    ATTACHMENT_PREVIEW_ROUTE,
    adminRoute(fields({ attachmentId: identifier, size: oneOf(...ATTACHMENT_PREVIEW_SIZES) }), empty),
  ],
]);
