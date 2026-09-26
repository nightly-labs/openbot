// @vitest-environment node

import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { claudeWriteOutsideRoots } from "./claude-workspace-sandbox";

let root: string;
let workspace: string;
let shared: string;
let outside: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "openbot-claude-sandbox-")));
  workspace = join(root, "workspace");
  shared = join(root, "shared");
  outside = join(root, "outside");
  await Promise.all([mkdir(workspace), mkdir(shared), mkdir(outside)]);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function outsideRoots(toolName: string, input: unknown): Promise<string | null> {
  return claudeWriteOutsideRoots(toolName, input, workspace, [workspace, shared]);
}

describe("claudeWriteOutsideRoots", () => {
  it("lets a file tool write a new file in the workspace and the shared folder", async () => {
    await expect(outsideRoots("Write", { file_path: join(workspace, "new/dir/a.txt") })).resolves.toBeNull();
    await expect(outsideRoots("Edit", { file_path: "relative.txt" })).resolves.toBeNull();
    await expect(outsideRoots("NotebookEdit", { notebook_path: join(shared, "a.ipynb") })).resolves.toBeNull();
  });

  it("asks for a write outside, also through a relative path", async () => {
    const target = join(outside, "a.txt");
    await expect(outsideRoots("Write", { file_path: target })).resolves.toBe(target);
    await expect(outsideRoots("MultiEdit", { file_path: "../outside/a.txt" })).resolves.toBe("../outside/a.txt");
    await expect(outsideRoots("Write", {})).resolves.toBe("an unknown path");
  });

  it("asks for a write through a link in the workspace that points outside", async () => {
    await symlink(outside, join(workspace, "link"));
    const target = join(workspace, "link/new/a.txt");
    await expect(outsideRoots("Write", { file_path: target })).resolves.toBe(target);
  });

  it("asks for a write to Claude's settings in the workspace", async () => {
    const target = join(workspace, ".claude/settings.local.json");
    await expect(outsideRoots("Write", { file_path: target })).resolves.toBe(target);
  });

  it("ignores tools that do not write files", async () => {
    await expect(outsideRoots("Read", { file_path: join(outside, "a.txt") })).resolves.toBeNull();
  });
});
