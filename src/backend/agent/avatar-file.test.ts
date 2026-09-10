import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AVATAR_IMAGE_LIMITS } from "@openbot/contracts/input-limits";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadAvatarFile } from "./avatar-file";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "openbot-avatar-file-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("avatar files", () => {
  it.each([
    ["image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    ["image/jpeg", [0xff, 0xd8, 0xff]],
    ["image/webp", [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]],
  ])("uses the shared content validation for %s, regardless of extension", async (mimeType, header) => {
    const bytes = Buffer.from(header);
    const path = join(root, "avatar.data");
    await writeFile(path, bytes);
    expect(await loadAvatarFile("avatar.data", root)).toEqual({ mimeType, bytes });
    expect(await loadAvatarFile(path, join(root, "other"))).toEqual({ mimeType, bytes });
    expect(await readFile(path)).toEqual(bytes);
  });

  it.each([Buffer.alloc(0), Buffer.from("not an image"), Buffer.from("GIF89a")])(
    "rejects unsupported image content %j",
    async (bytes) => {
      await writeFile(join(root, "avatar.png"), bytes);
      await expect(loadAvatarFile("avatar.png", root)).rejects.toThrow(
        "Choose a valid PNG, JPEG, or WebP avatar image.",
      );
    },
  );

  it("accepts the stored limit and tells the agent to resize larger files", async () => {
    const bytes = Buffer.alloc(AVATAR_IMAGE_LIMITS.storedBytes, 0xff);
    bytes[1] = 0xd8;
    await writeFile(join(root, "avatar.jpg"), bytes);
    expect((await loadAvatarFile("avatar.jpg", root)).bytes).toEqual(bytes);
    await writeFile(join(root, "avatar.jpg"), Buffer.concat([bytes, Buffer.from([0])]));
    await expect(loadAvatarFile("avatar.jpg", root)).rejects.toThrow(
      "Resize or compress a copy with your available tools",
    );
  });

  it("rejects missing files and directories", async () => {
    await expect(loadAvatarFile("missing.png", root)).rejects.toThrow("Use an existing local image path.");
    await expect(loadAvatarFile(root, root)).rejects.toThrow("regular file");
  });
});
