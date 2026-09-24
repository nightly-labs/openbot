import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_FILE_ACCEPT,
  attachmentMimeTypeForName,
  isSupportedAttachmentName,
  isSupportedAttachmentNameFor,
  supportedAttachmentExtensions,
} from "./attachment-files";

describe("attachment file whitelist", () => {
  it("accepts images, documents, text, Markdown, data, and source files", () => {
    expect(
      ["photo.png", "brief.pdf", "notes.txt", "README.MD", "data.json", "app.tsx", "report.docx", "Dockerfile"].every(
        isSupportedAttachmentName,
      ),
    ).toBe(true);
    expect(ATTACHMENT_FILE_ACCEPT).toContain(".pdf");
    expect(ATTACHMENT_FILE_ACCEPT).toContain(".md");
    expect(ATTACHMENT_FILE_ACCEPT).toContain(".txt");
  });

  it("rejects executable and archive formats", () => {
    expect(isSupportedAttachmentName("installer.exe")).toBe(false);
    expect(isSupportedAttachmentName("bundle.zip")).toBe(false);
    expect(isSupportedAttachmentName("no-extension")).toBe(false);
  });

  it("offers media only when the selected host supports it, without hiding other files", () => {
    const legacy = supportedAttachmentExtensions({ eml: false, media: false });
    expect(legacy).not.toContain("mp3");
    expect(legacy).not.toContain("mov");
    expect(legacy).not.toContain("eml");
    expect(legacy).toEqual(expect.arrayContaining(["png", "pdf", "txt"]));
    const media = supportedAttachmentExtensions({ eml: false, media: true });
    expect(media).toEqual(expect.arrayContaining(["mp3", "mov", "pdf"]));
    expect(media).not.toContain("eml");
    const eml = supportedAttachmentExtensions({ eml: true, media: false });
    expect(eml).toContain("eml");
    expect(eml).not.toContain("mp3");
    expect(eml).not.toContain("mov");
    expect(
      supportedAttachmentExtensions({ eml: true, media: true })
        .map((extension) => `.${extension}`)
        .join(","),
    ).toBe(ATTACHMENT_FILE_ACCEPT);
  });

  it("checks one name against the same host support as the picker filter", () => {
    const legacy = { eml: false, media: false };
    expect(isSupportedAttachmentNameFor("photo.png", legacy)).toBe(true);
    expect(isSupportedAttachmentNameFor("Dockerfile", legacy)).toBe(true);
    expect(isSupportedAttachmentNameFor("clip.MOV", legacy)).toBe(false);
    expect(isSupportedAttachmentNameFor("message.eml", legacy)).toBe(false);
    expect(isSupportedAttachmentNameFor("clip.mov", { eml: false, media: true })).toBe(true);
    expect(isSupportedAttachmentNameFor("message.eml", { eml: true, media: false })).toBe(true);
    expect(isSupportedAttachmentNameFor("setup.exe", { eml: true, media: true })).toBe(false);
  });

  it("assigns stable MIME types to supported formats", () => {
    expect(attachmentMimeTypeForName("README.md")).toBe("text/markdown");
    expect(attachmentMimeTypeForName("report.pdf")).toBe("application/pdf");
    expect(attachmentMimeTypeForName("report.docx")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(attachmentMimeTypeForName("recording.mp3")).toBe("audio/mpeg");
    expect(attachmentMimeTypeForName("recording.mov")).toBe("video/quicktime");
    expect(attachmentMimeTypeForName("message.eml")).toBe("message/rfc822");
    expect(attachmentMimeTypeForName("bundle.zip")).toBe("application/octet-stream");
  });
});
