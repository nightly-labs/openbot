import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  AGENT_SHELL_REGISTRY_VARIABLE,
  agentShellEnvironment,
  configureAgentShell,
  readAgentShellRegistry,
} from "./agent-shell";

const execFile = promisify(execFileCallback);
const directories: string[] = [];

async function baseDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "openbot-agent-shell-test-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("configureAgentShell", () => {
  it("writes a wrapper for each shell that passes its arguments through", async () => {
    const directory = await baseDirectory();

    expect(await configureAgentShell(directory)).toBe(true);

    for (const [name, real] of [
      ["sh", "/bin/sh"],
      ["bash", "/bin/bash"],
      ["zsh", "/bin/zsh"],
    ] as const) {
      const script = await readFile(join(directory, "bin", name), "utf8");
      expect(script).toContain(`exec ${real} "$@"`);
      expect(script).toContain("OPENBOT_AGENT_ID");
      expect(script).toContain(AGENT_SHELL_REGISTRY_VARIABLE);
    }
  });

  it("puts its wrappers before the inherited PATH and names the registry", async () => {
    const directory = await baseDirectory();
    await configureAgentShell(directory);

    const environment = agentShellEnvironment({ PATH: "/usr/bin:/bin" });

    expect(environment.PATH).toBe(`${join(directory, "bin")}:/usr/bin:/bin`);
    expect(environment[AGENT_SHELL_REGISTRY_VARIABLE]).toBe(join(directory, "registry"));
  });

  it("starts a new registry for each app run", async () => {
    const directory = await baseDirectory();
    await configureAgentShell(directory);
    const registry = agentShellEnvironment({ PATH: "/usr/bin:/bin" })[AGENT_SHELL_REGISTRY_VARIABLE] ?? "";
    await writeFile(registry, "10 1700000000 agent-1\n");

    await configureAgentShell(directory);

    expect(await readFile(registry, "utf8")).toBe("");
  });

  it("records the shell that an agent starts, and the one that it does not", async () => {
    const directory = await baseDirectory();
    await configureAgentShell(directory);
    const environment = agentShellEnvironment({ PATH: process.env.PATH ?? "/usr/bin:/bin" });

    await execFile(join(directory, "bin", "sh"), ["-c", "exit 0"], {
      env: { ...process.env, ...environment, OPENBOT_AGENT_ID: "agent-1" },
    });
    await execFile(join(directory, "bin", "sh"), ["-c", "exit 0"], {
      env: { ...process.env, ...environment },
    });

    const registry = await readAgentShellRegistry();
    expect(registry.size).toBe(1);
    expect([...registry.values()]).toEqual([{ agentId: "agent-1", startedAt: expect.any(Number) }]);
  });
});

describe("readAgentShellRegistry", () => {
  it("reads the last recorded agent for each process and ignores a malformed line", async () => {
    const directory = await baseDirectory();
    await configureAgentShell(directory);
    const registry = agentShellEnvironment({ PATH: "/usr/bin:/bin" })[AGENT_SHELL_REGISTRY_VARIABLE] ?? "";
    await writeFile(registry, "10 1700000000 agent-1\nnot a pid\n20 1700000001 agent-2\n10 1700000002 agent-3\n");

    const entries = await readAgentShellRegistry();

    expect([...entries]).toEqual([
      [10, { agentId: "agent-3", startedAt: 1_700_000_002 }],
      [20, { agentId: "agent-2", startedAt: 1_700_000_001 }],
    ]);
  });

  it("returns no entries when the registry does not exist", async () => {
    const directory = await baseDirectory();
    await configureAgentShell(directory);
    await rm(join(directory, "registry"));

    expect(await readAgentShellRegistry()).toEqual(new Map());
  });
});
