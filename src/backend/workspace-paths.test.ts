import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { resolveWorkspaceFile } from "./workspace-paths";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveWorkspaceFile directory support", () => {
  it("rejects directories by default to protect preview and remote download callers", async () => {
    const root = makeTempDir("openbot-ws-");
    mkdirSync(join(root, "docs"));
    const agent = { id: "agent-test", workspacePath: root };

    await expect(Effect.runPromise(resolveWorkspaceFile(agent, "docs/"))).rejects.toThrow();
  });

  it("resolves workspace folders and workspace root when allowDirectory is true", async () => {
    const root = makeTempDir("openbot-ws-");
    const docsDir = join(root, "docs");
    mkdirSync(docsDir);
    writeFileSync(join(docsDir, "readme.md"), "hello");
    const agent = { id: "agent-test", workspacePath: root };

    const sub = await Effect.runPromise(resolveWorkspaceFile(agent, "docs/", { allowDirectory: true }));
    expect(sub.path).toBe(realpathSync(docsDir));
    expect(sub.insideWorkspace).toBe(true);
    expect(sub.isDirectory).toBe(true);

    const rootResult = await Effect.runPromise(resolveWorkspaceFile(agent, root, { allowDirectory: true }));
    expect(rootResult.path).toBe(realpathSync(root));
    expect(rootResult.insideWorkspace).toBe(true);
    expect(rootResult.isDirectory).toBe(true);

    const fileResult = await Effect.runPromise(resolveWorkspaceFile(agent, "docs/readme.md", { allowDirectory: true }));
    expect(fileResult.isDirectory).toBe(false);
  });

  it("enforces workspace containment for directories unless allowOutside is enabled", async () => {
    const root = makeTempDir("openbot-ws-");
    const outside = makeTempDir("openbot-outside-");
    const agent = { id: "agent-test", workspacePath: root };

    await expect(Effect.runPromise(resolveWorkspaceFile(agent, outside, { allowDirectory: true }))).rejects.toThrow();

    const allowed = await Effect.runPromise(
      resolveWorkspaceFile(agent, outside, { allowDirectory: true, allowOutside: true }),
    );
    expect(allowed.path).toBe(realpathSync(outside));
    expect(allowed.insideWorkspace).toBe(false);
    expect(allowed.isDirectory).toBe(true);
  });
});
