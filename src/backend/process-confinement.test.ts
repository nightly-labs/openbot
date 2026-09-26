// @vitest-environment node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { confineSpawnTarget, grokStatePaths, ProcessConfinementUnavailableError } from "./process-confinement";

// The test folder must not be under the temporary folders, which the sandbox allows. The test runner
// can move `HOME` there, so the folder is in the checkout.
const TEST_PARENT = join(process.cwd(), ".openbot-build", "confinement-test");

let root: string;
let workspace: string;
let shared: string;
let outside: string;
let grokHome: string;

beforeEach(async () => {
  await mkdir(TEST_PARENT, { recursive: true });
  root = await realpath(await mkdtemp(join(TEST_PARENT, "run-")));
  workspace = join(root, "workspace");
  shared = join(root, "shared");
  outside = join(root, "outside");
  grokHome = join(root, "grok-home");
  await Promise.all([
    mkdir(workspace),
    mkdir(shared),
    mkdir(outside),
    mkdir(join(grokHome, "hooks"), { recursive: true }),
  ]);
  await writeFile(join(grokHome, "config.toml"), "");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** True when a confined shell could write `path`. */
function confinedWrite(path: string): boolean {
  const target = confineSpawnTarget(
    { command: "/bin/sh", args: ["-c", 'printf x > "$1"', "sh", path], windowsVerbatimArguments: false },
    { writableRoots: [workspace, shared] },
    grokStatePaths({ GROK_HOME: grokHome }, root),
    "darwin",
  );
  return spawnSync(target.command, target.args).status === 0 && existsSync(path);
}

describe.runIf(process.platform === "darwin")("confineSpawnTarget on macOS", () => {
  it("lets the process write in the roots and the provider state", () => {
    expect(confinedWrite(join(workspace, "a.txt"))).toBe(true);
    expect(confinedWrite(join(shared, "a.txt"))).toBe(true);
    expect(confinedWrite(join(grokHome, "session.json"))).toBe(true);
  });

  it("denies a write outside, to the provider's settings and hooks, and to project settings in a root", async () => {
    await mkdir(join(workspace, ".grok"));
    expect(confinedWrite(join(outside, "a.txt"))).toBe(false);
    expect(confinedWrite(join(grokHome, "config.toml"))).toBe(false);
    expect(confinedWrite(join(grokHome, "hooks", "start.sh"))).toBe(false);
    expect(confinedWrite(join(grokHome, "trusted_folders.toml"))).toBe(false);
    expect(confinedWrite(join(workspace, ".grok", "config.toml"))).toBe(false);
  });

  it("denies every provider's project settings in a root, also through a renamed folder", async () => {
    expect(confinedWrite(join(workspace, ".claude", "settings.local.json"))).toBe(false);
    expect(confinedWrite(join(shared, ".codex", "config.toml"))).toBe(false);
    // The Grok process below must not leave OpenCode settings for a later Full access session.
    expect(confinedWrite(join(workspace, "opencode.json"))).toBe(false);
    await mkdir(join(shared, ".opencode"));
    expect(confinedWrite(join(shared, ".opencode", "opencode.json"))).toBe(false);
    await mkdir(join(workspace, "staged"));
    expect(confinedWrite(join(workspace, "staged", "settings.json"))).toBe(true);
    const target = confineSpawnTarget(
      {
        command: "/bin/mv",
        args: [join(workspace, "staged"), join(workspace, ".claude")],
        windowsVerbatimArguments: false,
      },
      { writableRoots: [workspace, shared] },
      grokStatePaths({ GROK_HOME: grokHome }, root),
      "darwin",
    );
    expect(spawnSync(target.command, target.args).status).not.toBe(0);
    expect(existsSync(join(workspace, ".claude"))).toBe(false);
  });
});

describe("confineSpawnTarget", () => {
  it.each(["linux", "win32"] as const)("does not start the process on %s, which has no sandbox for it", (platform) => {
    expect(() =>
      confineSpawnTarget(
        { command: "grok", args: [], windowsVerbatimArguments: false },
        { writableRoots: ["/workspace"] },
        grokStatePaths({}, "/home/a"),
        platform,
      ),
    ).toThrow(ProcessConfinementUnavailableError);
  });
});
