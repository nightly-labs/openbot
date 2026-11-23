// The Kiro provider: how it starts `kiro-cli acp`, where its state is, how OpenBot finds the CLI, and
// that its descriptor and driver agree.
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentProviderDescriptor, isLocalOnlyProvider } from "@openbot/contracts/agent-providers";
import { agentTaskLimit } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { customAgentFlavor, KIRO_ACP_FLAVOR, kiroContextWindow } from "./acp-flavor";
import { resolveKiroCli } from "./cli";
import { kiroDataDirectory, kiroHomeDirectory, kiroStatePaths } from "./process-confinement";
import { BUILT_IN_PROVIDER_DRIVERS, KIRO_ARGV, requireProviderDriver } from "./provider-drivers";

describe("KIRO_ARGV", () => {
  it("names the V3 engine, which takes no agent, model or effort flag", () => {
    expect(KIRO_ARGV).toEqual(["acp", "--agent-engine=v3"]);
  });
});

describe("kiroContextWindow", () => {
  it("reads the size that a model description names", () => {
    expect(kiroContextWindow("Claude Opus 5.5 model with 1M context window")).toBe(1_000_000);
    expect(kiroContextWindow("OpenAI GPT 5.6 Sol with 1M context window")).toBe(1_000_000);
    expect(kiroContextWindow("A small model with 200K context window")).toBe(200_000);
    expect(kiroContextWindow("A model with 1.5M Context Window")).toBe(1_500_000);
  });

  it("gives null, not a guess, when the description names no size", () => {
    for (const description of ["", "Claude Haiku", "with a large context", "0M context window"])
      expect(kiroContextWindow(description)).toBeNull();
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

describe("KIRO_ACP_FLAVOR", () => {
  it("has the 120 s MCP call limit and the model option of the custom agent kiro-cli", () => {
    expect(KIRO_ACP_FLAVOR.mcpToolCallLimitMs).toBe(120_000);
    expect(KIRO_ACP_FLAVOR.modelConfigId).toBe("model");
    expect(customAgentFlavor("kiro-cli").mcpToolCallLimitMs).toBe(KIRO_ACP_FLAVOR.mcpToolCallLimitMs);
    expect(customAgentFlavor("kiro-cli").modelConfigId).toBe(KIRO_ACP_FLAVOR.modelConfigId);
  });

  it("reads the context percentage from the context_usage update of the V3 engine and no other update", () => {
    const read = KIRO_ACP_FLAVOR.contextPercentUpdate?.read;
    const info = (kiro: unknown) => ({ sessionUpdate: "session_info_update" as const, _meta: { kiro } });
    expect(read?.(info({ kind: "context_usage", contextUsage: { usagePercentage: 12.5 } }))).toBe(12.5);
    expect(read?.(info({ kind: "turn_start" }))).toBeNull();
    expect(read?.(info({ kind: "context_usage", contextUsage: { usagePercentage: "12" } }))).toBeNull();
    expect(read?.(info({ kind: "context_usage", contextUsage: { usagePercentage: -1 } }))).toBeNull();
    expect(read?.({ sessionUpdate: "session_info_update" })).toBeNull();
  });
});

describe("parallel turns of a Kiro agent", () => {
  it("gives a Kiro agent the task limit of any other agent, so its chat and its threads run together", () => {
    expect(agentTaskLimit({ provider: "kiro" }, 4)).toBe(4);
    expect(agentTaskLimit({ provider: "kiro", taskLimit: 3 }, 4)).toBe(3);
    expect(agentTaskLimit({ provider: "kiro" }, 8)).toBe(8);
  });

  it("keeps one turn at a time for the generic custom ACP agent", () => {
    expect(agentTaskLimit({ provider: "acp", taskLimit: 3 }, 4)).toBe(1);
  });
});

describe("the Kiro provider", () => {
  it("has one driver that signs in with `kiro-cli login` and signs out with `kiro-cli logout`", () => {
    const driver = requireProviderDriver("kiro");
    expect(BUILT_IN_PROVIDER_DRIVERS.filter((candidate) => candidate.id === "kiro")).toHaveLength(1);
    expect(driver.signIn).toMatchObject({ kind: "cli-command", command: { argv: ["login"] } });
    expect(driver.codeSignIn).toMatchObject({ command: { argv: ["login", "--use-device-flow"], closeInput: true } });
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
    // The code sign-in of the driver is a device code, so the descriptor says it too.
    expect(driver.codeSignIn).toMatchObject({ kind: "cli", flow: "device" });
    expect(descriptor.localCodeSignIn).toBe("device");
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

  it("refuses a release before Kiro CLI 2.36, which has no V3 engine, and takes 2.36 and later", async () => {
    expect(await failureText(await script("kiro-cli", 'echo "kiro-cli 2.35.9"'))).toMatch(/2\.35\.9.*2\.36\.0/u);
    for (const version of ["2.36.0", "3.0.0"]) {
      const executable = await script(`kiro-cli-${version}`, `echo "kiro-cli ${version}"`);
      expect(await failureText(executable)).toBeNull();
    }
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
