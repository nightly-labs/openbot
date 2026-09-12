// @vitest-environment node

import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadAgentRuntimeLock } from "./agent-runtime-lock";
import { installClaudeRuntime, validateClaudeArchive } from "./install-claude-runtime";
import { sha256 } from "./remote-desktop-runtime-release";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe.runIf(process.platform !== "win32")("bundled Claude installer", () => {
  // The fixture binary is a shell script, so a Linux target installs and verifies on macOS too.
  it.each([
    ["darwin-arm64", "mac/arm64"],
    ["linux-x64", "linux/x64"],
  ] as const)("installs a verified %s SDK binary into %s and reuses the current runtime", async (target, directory) => {
    const root = await temporaryRoot();
    const fixture = join(root, "fixture");
    const archive = join(root, "claude.tgz");
    const output = join(root, "output");
    const lock = structuredClone(await loadAgentRuntimeLock());
    await createPackage(fixture, lock.claude.artifacts[target].package);
    createArchive(fixture, archive);
    const archiveBytes = await readFile(archive);
    const binary = await readFile(join(fixture, "package/claude"));
    const license = await readFile(join(fixture, "package/LICENSE.md"));
    lock.claude.artifacts[target].assetSha256 = sha256(archiveBytes);
    lock.claude.artifacts[target].binarySha256 = sha256(binary);
    lock.claude.licenseSha256 = sha256(license);
    const fetchImpl = async () => new Response(archiveBytes, { status: 200 });

    await expect(installClaudeRuntime({ outputRoot: output, target, fetchImpl, lock })).resolves.toBe("installed");
    await expect(installClaudeRuntime({ outputRoot: output, target, fetchImpl, lock })).resolves.toBe("current");
    await expect(readFile(join(output, directory, "claude-package.json"), "utf8")).resolves.toContain('"2.1.263"');
    await expect(readFile(join(output, "licenses/Claude-Code-LICENSE.md"), "utf8")).resolves.toBe(
      license.toString("utf8"),
    );
    const mode = (await stat(join(output, directory, "bin/claude"))).mode & 0o777;
    expect(mode).toBe(0o755);
  });

  it("rejects links in an archive before extraction", async () => {
    const root = await temporaryRoot();
    const fixture = join(root, "fixture");
    const archive = join(root, "unsafe.tgz");
    await createPackage(fixture);
    await symlink("claude", join(fixture, "package/claude-link"));
    createArchive(fixture, archive);

    expect(() => validateClaudeArchive(archive, "claude")).toThrow("link or a special file");
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "openbot-claude-runtime-test-"));
  temporaryPaths.push(root);
  return root;
}

async function createPackage(root: string, packageName = "@anthropic-ai/claude-agent-sdk-darwin-arm64"): Promise<void> {
  const packageRoot = join(root, "package");
  await mkdir(packageRoot, { recursive: true });
  await Promise.all([
    writeFile(join(packageRoot, "claude"), "#!/bin/sh\nprintf '2.1.263 (Claude Code)\\n'\n"),
    writeFile(join(packageRoot, "LICENSE.md"), "Anthropic license fixture\n"),
    writeFile(join(packageRoot, "package.json"), `${JSON.stringify({ name: packageName, version: "0.3.263" })}\n`),
  ]);
  await chmod(join(packageRoot, "claude"), 0o755);
}

function createArchive(root: string, archive: string): void {
  execFileSync("tar", ["-czf", archive, "-C", root, "package"], { stdio: "inherit" });
}
