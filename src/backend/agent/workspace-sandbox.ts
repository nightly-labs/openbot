import { lstat, readlink, realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { type AgentSummary, workspaceAccessEnforced } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { isMissingFileError } from "../file-errors";
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

export function agentWriteAreas(
  agents: readonly Pick<AgentSummary, "id" | "additionalFolders" | "workspacePath">[],
  sharedRoot: string,
): string[] {
  return [
    ...new Set([
      sharedRoot,
      ...workspaceTemporaryPaths(),
      ...agents.flatMap((agent) => [agent.workspacePath, ...effectiveAgentFolders(agent)]),
    ]),
  ];
}

export const sandboxWritePaths = Effect.fn("sandboxWritePaths")(function* (
  paths: readonly string[],
  writeAreas: readonly string[],
) {
  const areas = yield* Effect.forEach([...new Set([...writeAreas, ...paths])], realOrResolved, {
    concurrency: "unbounded",
  });
  const resolved = yield* Effect.forEach(paths, (path) => fixedRealPath(path, areas), { concurrency: "unbounded" });
  return [
    ...new Set(
      paths.flatMap((path, index) => {
        const real = resolved[index];
        return real ? [path, real] : [path];
      }),
    ),
  ];
});

const MAX_LINKS = 40;

const fixedRealPath = Effect.fn("fixedRealPath")(function* (path: string, areas: readonly string[]) {
  if (!isAbsolute(path)) return null;
  let real = parse(path).root;
  const pending = pathNames(path.slice(real.length));
  let links = 0;
  for (let name = pending.shift(); name !== undefined; name = pending.shift()) {
    if (name === ".") continue;
    if (name === "..") {
      real = dirname(real);
      continue;
    }
    const next = join(real, name);
    const entry = yield* pathEntry(next);
    if (entry.kind === "missing") return resolve(next, ...pending);
    if (entry.kind === "unknown") return null;
    if (entry.kind === "entry") {
      real = next;
      continue;
    }
    links += 1;
    if (links > MAX_LINKS || areas.some((area) => isPathInside(area, real))) return null;
    const targetRoot = isAbsolute(entry.target) ? parse(entry.target).root : "";
    if (targetRoot) real = targetRoot;
    pending.unshift(...pathNames(entry.target.slice(targetRoot.length)));
  }
  return real;
});

type PathEntry = { kind: "missing" | "unknown" | "entry" } | { kind: "link"; target: string };

const pathEntry = Effect.fn("pathEntry")(function* (path: string) {
  const info = yield* Effect.tryPromise(() => lstat(path)).pipe(
    Effect.catch((error) => Effect.succeed(isMissingFileError(error.cause) ? ("missing" as const) : null)),
  );
  if (info === "missing") return { kind: "missing" } satisfies PathEntry;
  if (info === null) return { kind: "unknown" } satisfies PathEntry;
  if (!info.isSymbolicLink()) return { kind: "entry" } satisfies PathEntry;
  const target = yield* Effect.tryPromise(() => readlink(path)).pipe(Effect.catch(() => Effect.succeed(null)));
  return target === null ? ({ kind: "unknown" } satisfies PathEntry) : ({ kind: "link", target } satisfies PathEntry);
});

const realOrResolved = (path: string) =>
  Effect.tryPromise(() => realpath(path)).pipe(Effect.catch(() => Effect.succeed(resolve(path))));

function pathNames(path: string): string[] {
  return path.split(process.platform === "win32" ? /[\\/]/ : "/").filter((name) => name !== "");
}

const sandboxWritableRoots = (agent: SandboxedAgent, sharedRoot: string, writeAreas: readonly string[]) =>
  sandboxWritePaths(workspaceWritableRoots(agent, sharedRoot), writeAreas);

export const codexSandboxPolicy = Effect.fn("codexSandboxPolicy")(function* (
  agent: SandboxedAgent,
  sharedRoot: string,
  writeAreas: readonly string[],
): Effect.fn.Return<CodexSandboxPolicy> {
  if (!workspaceAccessEnforced(agent)) return { type: "dangerFullAccess" };
  return {
    type: "workspaceWrite",
    writableRoots: yield* sandboxWritableRoots(agent, sharedRoot, writeAreas),
    networkAccess: true,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  };
});

export type CodexSandboxConfig = { sandbox_workspace_write?: { writable_roots: string[]; network_access: boolean } };

export const codexSandboxConfig = Effect.fn("codexSandboxConfig")(function* (
  agent: SandboxedAgent,
  sharedRoot: string,
  writeAreas: readonly string[],
): Effect.fn.Return<CodexSandboxConfig> {
  if (!workspaceAccessEnforced(agent)) return {};
  return {
    sandbox_workspace_write: {
      writable_roots: yield* sandboxWritableRoots(agent, sharedRoot, writeAreas),
      network_access: true,
    },
  };
});
