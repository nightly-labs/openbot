import { describe, expect, it } from "vitest";
import { type StoredAttachment, toAttachmentSummary } from "./attachment-files";

const stored: StoredAttachment = {
  id: "attachment-1",
  name: "thread.eml",
  size: 2048,
  kind: "file",
  mimeType: "message/rfc822",
  previewKind: "none",
  previewUrl: null,
  path: "/tmp/thread.eml",
  sha256: "0".repeat(64),
};

describe("toAttachmentSummary", () => {
  it("shows an email with the text preview, and keeps media opaque on the wire", () => {
    expect(toAttachmentSummary(stored)).toMatchObject({ mimeType: "message/rfc822", previewKind: "text" });
    // The released v1-v4 validators accept only image, pdf, text, and none, so a recording stays
    // `none` here. The renderer reads the MIME type to offer playback.
    expect(toAttachmentSummary({ ...stored, name: "standup.mp3", mimeType: "audio/mpeg" })).toMatchObject({
      kind: "file",
      mimeType: "audio/mpeg",
      previewKind: "none",
    });
  });
});
