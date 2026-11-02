import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { type AgentSummary, workspaceAccessEnforced } from "@openbot/contracts/ipc";
import { Effect } from "effect";

type SandboxedAgent = Pick<AgentSummary, "access" | "additionalFolders" | "provider" | "workspacePath">;

/**
 * The sandbox mode sent with each thread. A `workspace` agent can write only in its workspace, the
 * shared folder and the temporary folders. Reads and the network stay open, as the Access setting
 * says. A write outside asks for approval, and `AttentionRegistry` always shows that approval.
 *
 * Codex takes the mode itself. Claude gets an explicit `workspaceOnly` flag instead and applies its
 * own sandbox (`claude-workspace-sandbox.ts`). A provider whose `workspaceEnforcement` is
 * `confined-process` ignores it: `ProviderRuntime` runs such an agent in a sandboxed process of its
 * own (`process-confinement.ts`).
 */
export function codexSandboxMode(agent: SandboxedAgent): "workspace-write" | "danger-full-access" {
  return workspaceAccessEnforced(agent) ? "workspace-write" : "danger-full-access";
}

/** Whether each added folder was a folder at its last check. A folder not checked yet counts as missing. */
const foundFolders = new Map<string, boolean>();

/**
 * Checks the agent's added folders on the disk. Run it before a session, a process or a turn starts:
 * a synchronous check of a stale network share would stop the whole process.
 */
export const checkAgentFolders = Effect.fn("checkAgentFolders")(function* (
  agent: Pick<AgentSummary, "additionalFolders">,
) {
  const folders = agent.additionalFolders ?? [];
  const found = yield* Effect.promise(() =>
    Promise.all(
      folders.map((folder) =>
        stat(folder).then(
          (stats) => stats.isDirectory(),
          () => false,
        ),
      ),
    ),
  );
  for (const [index, folder] of folders.entries()) foundFolders.set(folder, found[index] === true);
});

/**
 * The folders the user gave the agent (`additionalFolders`) that were on the disk at the last
 * `checkAgentFolders`. A moved or deleted one is left out: a provider can refuse to start with a root
 * that does not exist, and the instructions must not name a folder that the sandbox leaves out.
 */
export function existingAgentFolders(agent: Pick<AgentSummary, "additionalFolders">): string[] {
  return (agent.additionalFolders ?? []).filter((folder) => foundFolders.get(folder) === true);
}

/**
 * The folders a Workspace only agent may write, besides the temporary folders: its workspace, the
 * shared folder, and the added folders that exist.
 */
export function workspaceWritableRoots(
  agent: Pick<AgentSummary, "additionalFolders" | "workspacePath">,
  sharedRoot: string,
) {
  return [agent.workspacePath, sharedRoot, ...existingAgentFolders(agent)];
}

/**
 * The folders in those roots that a Workspace only agent must not change. Claude and the confined
 * providers block writes there. Codex takes writable roots only and cannot deny a folder in one, so
 * the instructions ask it instead. A folder that is not on the disk stays: the block also stops a
 * new folder at that path.
 */
export function workspaceExcludedFolders(agent: Pick<AgentSummary, "access" | "excludedFolders">): string[] {
  return workspaceAccessEnforced(agent) ? (agent.excludedFolders ?? []) : [];
}

export type CodexSandboxPolicy =
  | { type: "dangerFullAccess" }
  | {
      type: "workspaceWrite";
      writableRoots: string[];
      networkAccess: boolean;
      excludeTmpdirEnvVar: boolean;
      excludeSlashTmp: boolean;
    };

/**
 * The temporary folders that a Workspace only agent may write on every provider, as Codex allows them
 * (`$TMPDIR` and `/tmp`). Compilers, package managers, test runners and the providers need them.
 */
export function workspaceTemporaryPaths(platform: NodeJS.Platform = process.platform): string[] {
  return [...new Set(platform === "win32" ? [tmpdir()] : ["/tmp", tmpdir()])];
}

/** Sent with each turn. Codex keeps it for the turns after, so a changed setting applies at the next turn. */
export function codexSandboxPolicy(agent: SandboxedAgent, sharedRoot: string): CodexSandboxPolicy {
  if (!workspaceAccessEnforced(agent)) return { type: "dangerFullAccess" };
  return {
    type: "workspaceWrite",
    writableRoots: workspaceWritableRoots(agent, sharedRoot),
    networkAccess: true,
    // Compilers, package managers and test runners write temporary files, so the temporary folders stay
    // writable. The settings note and the agent instructions name them. The `config.toml` defaults agree.
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  };
}

/**
 * The same roots for the session default, in the `config.toml` shape. `thread/start` takes only the
 * sandbox mode, and without this the session would allow the workspace alone until its first turn.
 */
export function codexSandboxConfig(
  agent: SandboxedAgent,
  sharedRoot: string,
): { sandbox_workspace_write?: { writable_roots: string[]; network_access: boolean } } {
  if (!workspaceAccessEnforced(agent)) return {};
  return {
    sandbox_workspace_write: { writable_roots: workspaceWritableRoots(agent, sharedRoot), network_access: true },
  };
}
