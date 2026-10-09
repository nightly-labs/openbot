import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { describe, expect, it, vi } from "vitest";
import { createWebAttachmentMedia, WEB_THUMBNAIL_BYTES } from "./web-attachment-media";
import type { WebFile } from "./web-runtime";

function attachment(name: string, mimeType: string, size = 4): AttachmentSummary {
  return { id: name, name, size, kind: "file", mimeType, previewKind: "none", previewUrl: null };
}

function setup(options: { host?: () => string; fileType?: string; bytes?: number } = {}) {
  const download = vi.fn(
    async (id: string): Promise<WebFile> => ({
      name: id,
      mimeType: options.fileType ?? "text/html",
      base64: btoa("x".repeat(options.bytes ?? 4)),
    }),
  );
  const blobs: Blob[] = [];
  const create = vi.fn((blob: Blob) => {
    blobs.push(blob);
    return `blob:test/${blobs.length}`;
  });
  const revoke = vi.fn();
  const media = createWebAttachmentMedia({ download }, options.host ?? (() => "host-a"), { create, revoke });
  return { media, download, blobs, create, revoke };
}

describe("web attachment media", () => {
  it("never gives an object URL to a type that a browser can run as a page", async () => {
    const { media, download, create } = setup();
    for (const file of [
      attachment("page.html", "text/html"),
      attachment("logo.svg", "image/svg+xml"),
      attachment("page.xhtml", "application/xhtml+xml"),
      attachment("blob.bin", "application/octet-stream"),
      attachment("page.png.html", ""),
    ]) {
      expect(await media.load(file)).toBe(false);
      expect(media.url(file.id)).toBeUndefined();
    }
    expect(download).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("types the blob from the allowlist, not from the type that the host sends", async () => {
    const { media, blobs } = setup({ fileType: "text/html" });
    expect(await media.load(attachment("shot.png", "image/png"))).toBe(true);
    expect(blobs[0]?.type).toBe("image/png");
    expect(media.url("shot.png")).toBe("blob:test/1");
  });

  it("does not download a file above its limit", async () => {
    const { media, download } = setup();
    expect(await media.load(attachment("large.png", "image/png", WEB_THUMBNAIL_BYTES + 1))).toBe(false);
    expect(download).not.toHaveBeenCalled();
  });

  it("revokes the URLs on a host change and on dispose", async () => {
    let host = "host-a";
    const { media, revoke } = setup({ host: () => host });
    await media.load(attachment("one.png", "image/png"));
    host = "host-b";
    expect(media.url("one.png")).toBeUndefined();
    await media.load(attachment("two.png", "image/png"));
    expect(revoke).toHaveBeenCalledWith("blob:test/1");
    media.dispose();
    expect(revoke).toHaveBeenCalledWith("blob:test/2");
    expect(media.url("two.png")).toBeUndefined();
  });

  it("revokes the least recently used URL when the cache is full", async () => {
    const size = 9 * 1024 * 1024;
    const { media, revoke } = setup({ bytes: size });
    const clip = (index: number) => attachment(`clip-${index}.mp3`, "audio/mpeg", size);
    for (let index = 1; index <= 8; index += 1) expect(await media.load(clip(index))).toBe(true);
    expect(revoke).toHaveBeenCalledWith("blob:test/1");
    expect(media.url("clip-1.mp3")).toBeUndefined();
    expect(media.url("clip-8.mp3")).toBe("blob:test/8");
  });
});
