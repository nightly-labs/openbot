// @vitest-environment node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCauseEffect } from "../backend/effect-boundary";
import { resolveWorkspaceFile } from "../backend/workspace-paths";
import { previewWorkspacePath } from "./workspace-preview";

// A 1x1 PNG, so the preview takes the same path a real named image takes.
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
  (character) => character.charCodeAt(0),
);

const directories: string[] = [];

async function workspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "openbot-workspace-preview-"));
  directories.push(directory);
  return directory;
}

function read(workspacePath: string, path: string) {
  return previewWorkspacePath(() => runCauseEffect(resolveWorkspaceFile({ id: "agent-1", workspacePath }, path)), path);
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("workspace file preview", () => {
  it("answers a path that is not there with a missing preview, not a failed read", async () => {
    const preview = await read(await workspace(), "example.png");
    expect(preview).toMatchObject({
      name: "example.png",
      size: 0,
      previewKind: "none",
      bytes: null,
      missing: true,
    });
  });

  it("reads a named workspace image as an image preview", async () => {
    const directory = await workspace();
    await writeFile(join(directory, "dot.png"), PNG);
    const preview = await read(directory, "dot.png");
    expect(preview).toMatchObject({
      name: "dot.png",
      size: PNG.byteLength,
      mimeType: "image/png",
      previewKind: "image",
    });
    expect(preview.bytes).toEqual(PNG);
    expect(preview.missing).toBeUndefined();
  });

  it("still fails for a path outside the workspace", async () => {
    const directory = await workspace();
    const outside = await workspace();
    const outsideFile = join(outside, "dot.png");
    await writeFile(outsideFile, PNG);
    await expect(read(directory, relative(directory, outsideFile))).rejects.toMatchObject({ reason: "outside" });
  });
});
