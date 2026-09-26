import { type AgentSummary, workspaceAccessEnforced } from "@openbot/contracts/ipc";

type SandboxedAgent = Pick<AgentSummary, "access" | "provider" | "workspacePath">;

/**
 * The Codex sandbox for one agent. A `workspace` agent can write only in its workspace and the
 * shared folder. Reads and the network stay open, as the Access setting says. A command that must
 * write outside asks for approval, and `AttentionRegistry` always shows that approval.
 *
 * The other providers ignore these fields, so their agents keep full access.
 */
export function codexSandboxMode(agent: SandboxedAgent): "workspace-write" | "danger-full-access" {
  return workspaceAccessEnforced(agent) ? "workspace-write" : "danger-full-access";
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

/** Sent with each turn. Codex keeps it for the turns after, so a changed setting applies at the next turn. */
export function codexSandboxPolicy(agent: SandboxedAgent, sharedRoot: string): CodexSandboxPolicy {
  if (!workspaceAccessEnforced(agent)) return { type: "dangerFullAccess" };
  return {
    type: "workspaceWrite",
    writableRoots: [agent.workspacePath, sharedRoot],
    networkAccess: true,
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
  return { sandbox_workspace_write: { writable_roots: [agent.workspacePath, sharedRoot], network_access: true } };
}
