import { tmpdir } from "node:os";
import { type AgentSummary, workspaceAccessEnforced } from "@openbot/contracts/ipc";

type SandboxedAgent = Pick<AgentSummary, "access" | "provider" | "workspacePath">;

/**
 * The sandbox mode sent with each thread. A `workspace` agent can write only in its workspace, the
 * shared folder and the temporary folders. Reads and the network stay open, as the Access setting
 * says. A write outside asks for approval, and `AttentionRegistry` always shows that approval.
 *
 * Codex takes the mode itself. The Claude client reads `workspace-write` and applies its own
 * sandbox (`claude-workspace-sandbox.ts`). A provider whose `workspaceEnforcement` is
 * `confined-process` ignores it: `ProviderRuntime` runs such an agent in a sandboxed process of its
 * own (`process-confinement.ts`).
 */
export function codexSandboxMode(agent: SandboxedAgent): "workspace-write" | "danger-full-access" {
  return workspaceAccessEnforced(agent) ? "workspace-write" : "danger-full-access";
}

/** The folders a Workspace only agent may write, besides the temporary folders. */
export function workspaceWritableRoots(agent: Pick<AgentSummary, "workspacePath">, sharedRoot: string) {
  return [agent.workspacePath, sharedRoot];
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
