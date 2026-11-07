// A shell that an agent starts records itself here, so OpenBot can still tell who started a
// background program after macOS hides the environment of Apple system programs. `ps -E` shows
// `/bin/sh`, `/bin/zsh`, `/bin/sleep` and `/usr/bin/curl` without their environment, and the marker
// alone would then leave the program unverified and impossible to stop.
//
// The provider starts a command through `sh -c` or the user's login shell. Each provider gets a
// folder of wrappers first on its `PATH`, and those wrappers add `pid startedAt agentId` to one file
// before they `exec` the real shell. A program left in the background keeps the process group of
// that shell, so its pgid still names the agent after its parent is gone. `startedAt` tells a reused
// pid apart from the shell that recorded it.

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const AGENT_SHELL_REGISTRY_VARIABLE = "OPENBOT_AGENT_SHELL_REGISTRY";

export interface AgentShellRegistration {
  readonly agentId: string;
  readonly startedAt: number;
}

const REAL_SHELLS = { sh: "/bin/sh", bash: "/bin/bash", zsh: "/bin/zsh" } as const;
const MAX_REGISTRY_BYTES = 4 * 1024 * 1024;

let configuration: { binDirectory: string; registryPath: string } | undefined;

function wrapper(shell: string): string {
  return `#!/bin/sh
# The environment holds an agent id only in a shell that an agent started.
if [ -n "\${OPENBOT_AGENT_ID:-}" ] && [ -n "\${OPENBOT_AGENT_SHELL_REGISTRY:-}" ]; then
  case "$OPENBOT_AGENT_ID" in
    *[!A-Za-z0-9_.-]*) ;;
    *)
      started=$(/bin/date +%s 2>/dev/null) || started=
      if [ -n "$started" ]; then
        printf '%s %s %s\\n' "$$" "$started" "$OPENBOT_AGENT_ID" >> "$OPENBOT_AGENT_SHELL_REGISTRY" 2>/dev/null || true
      fi
      ;;
  esac
fi
exec ${shell} "$@"
`;
}

/**
 * Writes the wrappers that record the agent of a shell, and returns false when the folder cannot be
 * prepared. OpenBot still runs without them, but a background task that macOS hides the environment
 * of stays display only.
 */
export async function configureAgentShell(baseDirectory: string): Promise<boolean> {
  try {
    const binDirectory = join(baseDirectory, "bin");
    const registryPath = join(baseDirectory, "registry");
    await mkdir(binDirectory, { recursive: true });
    // An app run starts a new registry, so an entry from an earlier run cannot name a reused pid.
    await writeFile(registryPath, "");
    for (const [name, shell] of Object.entries(REAL_SHELLS)) {
      const path = join(binDirectory, name);
      await writeFile(path, wrapper(shell), { mode: 0o755 });
      await chmod(path, 0o755);
    }
    configuration = { binDirectory, registryPath };
    return true;
  } catch {
    configuration = undefined;
    return false;
  }
}

/** The variables that put the wrappers first on `PATH`, read when a provider or a command starts. */
export function agentShellEnvironment(inherited: NodeJS.ProcessEnv = process.env): Record<string, string> {
  if (!configuration) return {};
  const path = inherited.PATH ?? "";
  const segments = path.split(":").filter((segment) => segment.length > 0);
  return {
    PATH: segments.includes(configuration.binDirectory) ? path : [configuration.binDirectory, ...segments].join(":"),
    [AGENT_SHELL_REGISTRY_VARIABLE]: configuration.registryPath,
  };
}

/** The agent and start time that each shell pgid recorded, for the process table scan. */
export async function readAgentShellRegistry(): Promise<Map<number, AgentShellRegistration>> {
  if (!configuration) return new Map();
  let text: string;
  try {
    text = await readFile(configuration.registryPath, "utf8");
  } catch {
    return new Map();
  }
  // The file grows by one short line per shell. A very old one is read from its tail only.
  let truncated = false;
  if (text.length > MAX_REGISTRY_BYTES) {
    text = text.slice(-MAX_REGISTRY_BYTES);
    truncated = true;
  }
  const entries = new Map<number, AgentShellRegistration>();
  const lines = text.split("\n");
  // A tail starts in the middle of a line; do not read a partial record as a real one.
  for (const line of truncated ? lines.slice(1) : lines) {
    const [pidText, startedText, agentId, ...rest] = line.trim().split(/\s+/u);
    if (rest.length > 0 || !agentId) continue;
    const pid = Number(pidText);
    const startedAt = Number(startedText);
    if (Number.isInteger(pid) && pid > 0 && Number.isInteger(startedAt) && startedAt > 0)
      entries.set(pid, { agentId, startedAt });
  }
  return entries;
}
