import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute } from "node:path";
import { type AgentSummary, workspaceAccessEnforced } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { isPathInside } from "../path-containment";

type SandboxedAgent = Pick<AgentSummary, "id" | "access" | "additionalFolders" | "provider" | "workspacePath">;

export function codexSandboxMode(agent: SandboxedAgent): "workspace-write" | "danger-full-access" {
  return workspaceAccessEnforced(agent) ? "workspace-write" : "danger-full-access";
}

export type CodexApprovalPolicy = "untrusted" | "on-request";

export function codexApprovalPolicy(agent: Pick<AgentSummary, "access">, asksFirst: boolean): CodexApprovalPolicy {
  return asksFirst && !workspaceAccessEnforced(agent) ? "untrusted" : "on-request";
}

const foundFolders = new Map<string, boolean>();

type FolderAgent = Pick<AgentSummary, "id" | "additionalFolders">;

let channelFoldersOf: (agentId: string) => readonly string[] = () => [];

export function setChannelFolderSource(source: (agentId: string) => readonly string[]): void {
  channelFoldersOf = source;
}

export function effectiveAgentFolders(agent: FolderAgent): string[] {
  const own = agent.additionalFolders ?? [];
  return [...own, ...channelFoldersOf(agent.id).filter((folder) => !own.includes(folder))];
}

export const checkAgentFolders = Effect.fn("checkAgentFolders")(function* (agent: FolderAgent) {
  const folders = effectiveAgentFolders(agent);
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

export function existingAgentFolders(agent: FolderAgent): string[] {
  return effectiveAgentFolders(agent).filter((folder) => foundFolders.get(folder) === true);
}

export function workspaceWritableRoots(
  agent: Pick<AgentSummary, "id" | "additionalFolders" | "workspacePath">,
  sharedRoot: string,
) {
  return [agent.workspacePath, sharedRoot, ...existingAgentFolders(agent)];
}

export function workspaceExcludedFolders(agent: Pick<AgentSummary, "access" | "excludedFolders">): string[] {
  return workspaceAccessEnforced(agent) ? (agent.excludedFolders ?? []) : [];
}

export function confinedWritesAllowed(
  agent: Pick<AgentSummary, "id" | "access" | "additionalFolders" | "excludedFolders" | "workspacePath">,
  sharedRoot: string,
  paths: readonly string[],
): boolean {
  if (!workspaceAccessEnforced(agent) || paths.length === 0) return false;
  const roots = workspaceWritableRoots(agent, sharedRoot);
  const excluded = workspaceExcludedFolders(agent);
  return paths.every(
    (path) =>
      isAbsolute(path) &&
      roots.some((root) => isPathInside(root, path)) &&
      !excluded.some((folder) => isPathInside(folder, path)),
  );
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

export function workspaceTemporaryPaths(platform: NodeJS.Platform = process.platform): string[] {
  return [...new Set(platform === "win32" ? [tmpdir()] : ["/tmp", tmpdir()])];
}

export function codexSandboxPolicy(agent: SandboxedAgent, sharedRoot: string): CodexSandboxPolicy {
  if (!workspaceAccessEnforced(agent)) return { type: "dangerFullAccess" };
  return {
    type: "workspaceWrite",
    writableRoots: workspaceWritableRoots(agent, sharedRoot),
    networkAccess: true,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  };
}

export function codexSandboxConfig(
  agent: SandboxedAgent,
  sharedRoot: string,
): { sandbox_workspace_write?: { writable_roots: string[]; network_access: boolean } } {
  if (!workspaceAccessEnforced(agent)) return {};
  return {
    sandbox_workspace_write: { writable_roots: workspaceWritableRoots(agent, sharedRoot), network_access: true },
  };
}
