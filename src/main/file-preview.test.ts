// @vitest-environment node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ATTACHMENT_LIMITS } from "@openbot/contracts/input-limits";
import { afterEach, describe, expect, it } from "vitest";
import { filePreviewFromBytes, localFilePreview, mimeTypeForName } from "./file-preview";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("file previews", () => {
  it("classifies Markdown, common source files, images, and PDFs", () => {
    expect(filePreviewFromBytes("recipe.md", new Uint8Array([35]))).toMatchObject({
      mimeType: "text/markdown",
      previewKind: "markdown",
    });
    expect(filePreviewFromBytes("main.py", new Uint8Array([1]))).toMatchObject({ previewKind: "text" });
    expect(filePreviewFromBytes("photo.webp", new Uint8Array([1]))).toMatchObject({
      mimeType: "image/webp",
      previewKind: "image",
    });
    expect(filePreviewFromBytes("report.pdf", new Uint8Array([1]))).toMatchObject({ previewKind: "pdf" });
    expect(mimeTypeForName("Dockerfile")).toBe("text/plain");
  });

  it("classifies playable media, SVG, and email so the panel can show them", () => {
    expect(filePreviewFromBytes("interview.mp3", new Uint8Array([1]))).toMatchObject({
      mimeType: "audio/mpeg",
      previewKind: "audio",
    });
    expect(filePreviewFromBytes("demo.mov", new Uint8Array([1]))).toMatchObject({
      mimeType: "video/quicktime",
      previewKind: "video",
    });
    expect(filePreviewFromBytes("diagram.svg", new Uint8Array([1]))).toMatchObject({
      mimeType: "image/svg+xml",
      previewKind: "image",
    });
    expect(filePreviewFromBytes("thread.eml", new Uint8Array([1]))).toMatchObject({
      mimeType: "message/rfc822",
      previewKind: "text",
    });
  });

  it("keeps the bytes for every kind it can show", () => {
    for (const name of ["interview.mp3", "demo.mov", "diagram.svg", "thread.eml"]) {
      expect(filePreviewFromBytes(name, new Uint8Array([1])).bytes).not.toBeNull();
    }
  });

  it("does not transfer bytes for unsupported local files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openbot-file-preview-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "archive.zip");
    await writeFile(path, new Uint8Array([1, 2, 3]));

    await expect(localFilePreview(path, "archive.zip", 3)).resolves.toEqual({
      name: "archive.zip",
      size: 3,
      mimeType: "application/octet-stream",
      previewKind: "none",
      bytes: null,
    });
  });

  it("rejects oversized previews before reading local content", async () => {
    await expect(
      localFilePreview("/does/not/need/to/exist", "large.txt", ATTACHMENT_LIMITS.fileBytes + 1),
    ).rejects.toThrow("100 MB");
  });
});
