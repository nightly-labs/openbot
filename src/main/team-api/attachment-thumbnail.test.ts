import { expect, it } from "vitest";
import { createAttachmentThumbnailCache } from "./attachment-thumbnail";

it("shares thumbnail work and serializes different files without retaining failed renders", async () => {
  const calls: string[] = [];
  let release = () => {};
  const first = new Promise<void>((resolve) => {
    release = resolve;
  });
  const load = createAttachmentThumbnailCache(async (path) => {
    calls.push(path);
    if (path === "first") await first;
    if (path === "bad") throw new Error("Unsupported image");
    return Buffer.from(path);
  });
  const pending = load("first");
  expect(load("first")).toBe(pending);
  const second = load("second");
  await Promise.resolve();
  expect(calls).toEqual(["first"]);
  release();
  await expect(second).resolves.toEqual(Buffer.from("second"));
  await expect(load("first")).resolves.toEqual(Buffer.from("first"));
  expect(calls).toEqual(["first", "second"]);
  await expect(load("bad")).rejects.toThrow("Unsupported image");
  await expect(load("bad")).rejects.toThrow("Unsupported image");
  expect(calls.slice(-2)).toEqual(["bad", "bad"]);
});
