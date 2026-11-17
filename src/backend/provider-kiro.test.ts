// The Kiro provider: how it starts `kiro-cli acp`, where its state is, how OpenBot finds the CLI, and
// that its descriptor and driver agree.
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentProviderDescriptor, isLocalOnlyProvider } from "@openbot/contracts/agent-providers";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveKiroCli } from "./cli";
import { kiroDataDirectory, kiroHomeDirectory, kiroStatePaths } from "./process-confinement";
import { BUILT_IN_PROVIDER_DRIVERS, kiroArgv, requireProviderDriver } from "./provider-drivers";

describe("kiroArgv", () => {
  it("names the V2 engine from Kiro CLI 2.36", () => {
    for (const version of ["2.36.0", "2.37.1", "3.0.0", "3.2.4", "10.0.0"])
      expect(kiroArgv(version)).toEqual(["acp", "--agent-engine=v2"]);
  });

  it("does not send the flag to a release that refuses it", () => {
    for (const version of ["2.35.9", "2.0.0", "1.9.0"]) expect(kiroArgv(version)).toEqual(["acp"]);
  });

  it("starts without the flag when the version is not a number", () => {
    expect(kiroArgv("")).toEqual(["acp"]);
  });
});

describe("Kiro state folders", () => {
  it("puts the data folder where each system keeps it", () => {
    expect(kiroDataDirectory({}, "/Users/ada", "darwin")).toBe("/Users/ada/Library/Application Support/kiro-cli");
    expect(kiroDataDirectory({}, "/home/ada", "linux")).toBe("/home/ada/.local/share/kiro-cli");
    expect(kiroDataDirectory({ XDG_DATA_HOME: "/data" }, "/home/ada", "linux")).toBe("/data/kiro-cli");
  });

  it("lets a confined process write its folders and keeps the settings and code read-only", () => {
    const state = kiroStatePaths({}, "/home/ada");
    const kiroHome = kiroHomeDirectory("/home/ada");
    expect(state.writable).toContain(kiroHome);
    expect(state.writable).toContain(kiroDataDirectory({}, "/home/ada"));
    for (const name of ["settings", "agents", "steering", "skills", "powers", "extensions", "kiro.env"])
      expect(state.protected).toContain(join(kiroHome, name));
    // Every protected path is inside a writable folder, as the sandbox needs.
    for (const path of state.protected) expect(state.writable.some((folder) => path.startsWith(folder))).toBe(true);
  });
});

describe("the Kiro provider", () => {
  it("has one driver that signs in outside OpenBot and signs out with `kiro-cli logout`", () => {
    const driver = requireProviderDriver("kiro");
    expect(BUILT_IN_PROVIDER_DRIVERS.filter((candidate) => candidate.id === "kiro")).toHaveLength(1);
    expect(driver.signIn).toEqual({ kind: "external" });
    expect(driver.signOut?.argv).toEqual(["logout"]);
    expect(driver.authState({ type: "builder-id", email: "ada@example.com" })).toEqual({
      kind: "kiro",
      email: "ada@example.com",
    });
  });

  it("declares in the descriptor what the driver does", () => {
    const descriptor = agentProviderDescriptor("kiro");
    const driver = requireProviderDriver("kiro");
    expect(descriptor.authKind).toBe("kiro");
    expect(descriptor.concurrentTurns).toBe(true);
    // No code sign-in in the driver, so none in the descriptor.
    expect(driver.codeSignIn).toBeUndefined();
    expect(descriptor.localCodeSignIn).toBeNull();
    // Kiro CLI 2.37.1 reads `.kiro/skills` only.
    expect(descriptor.skillFolders).toEqual([".kiro/skills"]);
    expect(isLocalOnlyProvider("kiro")).toBe(true);
  });
});

describe("resolveKiroCli", () => {
  let folder: string;
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "openbot-kiro-cli-test-"));
  });
  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  async function script(name: string, body: string): Promise<string> {
    const path = join(folder, name);
    await writeFile(path, `#!/bin/sh\n${body}\n`);
    await chmod(path, 0o755);
    return path;
  }

  /** The text of the error that the resolver gives, or null when it finds a CLI. */
  async function failureText(executable: string): Promise<string | null> {
    const failure = await Effect.runPromise(
      resolveKiroCli({ systemCandidates: [executable] }).pipe(
        Effect.map(() => null),
        Effect.catch((error) =>
          Effect.succeed(error.cause instanceof Error ? error.cause.message : String(error.cause)),
        ),
      ),
    );
    return failure;
  }

  it("reads the version that `kiro-cli --version` prints", async () => {
    const executable = await script("kiro-cli", 'echo "kiro-cli 2.37.1"');
    const cli = await Effect.runPromise(resolveKiroCli({ systemCandidates: [executable] }));
    expect(cli).toMatchObject({ executable, version: "2.37.1", source: "system" });
  });

  it("says that Kiro CLI is missing when no candidate exists", async () => {
    expect(await failureText(join(folder, "absent"))).toMatch(/not installed/u);
  });

  it("says that Kiro CLI did not start when the file runs and fails", async () => {
    expect(await failureText(await script("kiro-cli", "exit 3"))).toMatch(/could not start/u);
  });

  it("does not take output that is not a Kiro CLI version", async () => {
    expect(await failureText(await script("kiro-cli", 'echo "something else"'))).toMatch(/could not start/u);
  });
});
