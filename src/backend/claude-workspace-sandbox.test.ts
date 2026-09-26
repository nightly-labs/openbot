// @vitest-environment node

import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { claudeWriteOutsideRoots } from "./claude-workspace-sandbox";

// The temporary folders are writable, so the test folder is in the checkout.
const TEST_PARENT = join(process.cwd(), ".openbot-build", "claude-sandbox-test");

let root: string;
let workspace: string;
let shared: string;
let outside: string;

beforeEach(async () => {
  await mkdir(TEST_PARENT, { recursive: true });
  root = await realpath(await mkdtemp(join(TEST_PARENT, "run-")));
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
  it("lets a file tool write a new file in the workspace, the shared folder and a temporary folder", async () => {
    await expect(outsideRoots("Write", { file_path: join(workspace, "new/dir/a.txt") })).resolves.toBeNull();
    await expect(outsideRoots("Edit", { file_path: "relative.txt" })).resolves.toBeNull();
    await expect(outsideRoots("NotebookEdit", { notebook_path: join(shared, "a.ipynb") })).resolves.toBeNull();
    await expect(outsideRoots("Write", { file_path: join(tmpdir(), "openbot-a.txt") })).resolves.toBeNull();
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

  it("asks for a write through a link to a file outside that does not exist yet, and through a loop", async () => {
    await symlink(join(outside, "missing/a.txt"), join(workspace, "dangling"));
    await symlink(join(workspace, "loop-b"), join(workspace, "loop-a"));
    await symlink(join(workspace, "loop-a"), join(workspace, "loop-b"));
    const dangling = join(workspace, "dangling");
    const loop = join(workspace, "loop-a");
    await expect(outsideRoots("Write", { file_path: dangling })).resolves.toBe(dangling);
    await expect(outsideRoots("Write", { file_path: loop })).resolves.toBe(loop);
  });

  it("asks for a write to Claude's settings in the workspace", async () => {
    const target = join(workspace, ".claude/settings.local.json");
    await expect(outsideRoots("Write", { file_path: target })).resolves.toBe(target);
  });

  it("ignores tools that do not write files", async () => {
    await expect(outsideRoots("Read", { file_path: join(outside, "a.txt") })).resolves.toBeNull();
  });
});
