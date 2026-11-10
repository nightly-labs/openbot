import {
  ARCHIVE_ATTACHMENT_EXTENSIONS,
  attachmentMimeTypeForName,
  isSupportedAttachmentName,
  MEDIA_ATTACHMENT_EXTENSIONS,
  MP4_ATTACHMENT_EXTENSIONS,
} from "@openbot/contracts/attachment-files";
import { describe, expect, it } from "vitest";

describe("attachment extensions", () => {
  it("takes the audio and video formats recorders and encoders actually write", () => {
    for (const name of ["take.wav", "take.m4a", "take.flac", "take.ogg", "clip.webm", "clip.mkv"]) {
      expect(isSupportedAttachmentName(name), name).toBe(true);
    }
  });

  it("takes the archives a build or a capture produces", () => {
    for (const name of ["pack.tar", "log.gz", "bundle.tgz", "set.7z", "set.rar"]) {
      expect(isSupportedAttachmentName(name), name).toBe(true);
    }
  });

  it("still refuses a type it has no reader for", () => {
    expect(isSupportedAttachmentName("clip.m4v")).toBe(false);
    expect(isSupportedAttachmentName("book.epub")).toBe(false);
  });

  it("keeps every new name in exactly one capability list", () => {
    const all = [...MEDIA_ATTACHMENT_EXTENSIONS, ...MP4_ATTACHMENT_EXTENSIONS, ...ARCHIVE_ATTACHMENT_EXTENSIONS];
    expect(new Set(all).size).toBe(all.length);
  });

  it("gives each new extension a content type", () => {
    expect(attachmentMimeTypeForName("take.wav")).toBe("audio/wav");
    expect(attachmentMimeTypeForName("clip.webm")).toBe("video/webm");
    expect(attachmentMimeTypeForName("log.gz")).toBe("application/gzip");
  });
});
