// Frozen optional attachment-preview-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: `GET
// /v1/attachments/<id>/preview` answers a small copy of an image attachment, for a card that shows the
// picture small, such as a step on the Workflows canvas. The member reads it with the same access as
// the file itself (`GET /v1/attachments/<id>`). The copy has the shape of the file, and its longest side
// is at most `ATTACHMENT_PREVIEW_EDGE` pixels. It is a JPEG, or a PNG when the picture has clear pixels.
// The `Content-Type` header names the type. When the host cannot make a smaller copy (a type that it
// cannot decode, or a picture that is already small), it answers the file itself, with its own type.
// A file that is not an image gets 415. An attachment id names bytes that do not change, so a client can
// keep the answer as long as it keeps the file. A client asks for it only from a host that sends this
// capability; without it, the client reads the whole file, as before. Over WebRTC the request frame is
// the empty object, as for the other bodyless routes that came after the frozen no-body list. Widening
// any of it needs a second capability string.

export const ATTACHMENT_PREVIEW_CAPABILITY = "attachment-preview-v1";

/** The longest side, in pixels, of a preview. */
export const ATTACHMENT_PREVIEW_EDGE = 768;

/** The preview route. Its WebRTC request frame is `{}`: the frozen no-body list cannot learn it. */
export function isAttachmentPreviewRoute(method: string, path: string): boolean {
  return (
    method === "GET" && /^\/v1\/attachments\/[^/]+\/preview$/u.test(new URL(path, "http://openbot.invalid").pathname)
  );
}
