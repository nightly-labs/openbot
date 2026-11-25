import { readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type AgentSummary,
  WORKSPACE_DIRECTORY_LIMIT,
  type WorkspaceDirectory,
  type WorkspaceDirectoryEntry,
} from "@openbot/contracts/ipc";
import { legacyAgentId } from "@openbot/contracts/validation";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result } from "effect";
import { type AttachmentOperationError, attachmentCall, attachmentFailure } from "./attachment-effects";
import { isRecord } from "./protocol";

export interface ResolvedSharedFile {
  path: string;
  name: string;
  size: number;
}

export interface ResolvedWorkspaceFile extends ResolvedSharedFile {
  insideWorkspace: boolean;
}

const LOCATION_SUFFIX = /(?::\d+(?::\d+)?|#L\d+(?:C\d+)?(?:-L?\d+(?:C\d+)?)?)$/u;

function withoutSlashBeforeDrive(path: string): string {
  return process.platform === "win32" && /^[/\\][A-Za-z]:[/\\]/u.test(path) ? path.slice(1) : path;
}

export function sharedPathFromInput(sharedRoot: string, written: string): string {
  const inputPath = withoutSlashBeforeDrive(written);
  const normalized = inputPath.replaceAll("\\", "/");
  for (const prefix of ["~/OpenBot/Shared/", "OpenBot/Shared/", "Shared/"]) {
    if (normalized.startsWith(prefix)) return join(sharedRoot, normalized.slice(prefix.length));
  }
  return isAbsolute(inputPath) ? inputPath : join(sharedRoot, normalized);
}

export function workspacePathFromInput(workspaceRoot: string, agentId: string, inputPath: string): string {
  const decoded = withoutSlashBeforeDrive(decodePath(inputPath.trim()));
  const normalized = decoded.replaceAll("\\", "/");
  const legacyId = legacyAgentId(agentId);
  for (const prefix of [
    `~/OpenBot/Agents/${agentId}/`,
    `OpenBot/Agents/${agentId}/`,
    `~/OpenBot/Bots/${legacyId}/`,
    `OpenBot/Bots/${legacyId}/`,
  ]) {
    if (normalized.startsWith(prefix)) return join(workspaceRoot, normalized.slice(prefix.length));
  }
  if (normalized.startsWith("~/")) return join(homedir(), normalized.slice(2));
  return isAbsolute(decoded) ? decoded : join(workspaceRoot, normalized);
}

export function rebaseLegacyWorkspacePath(workspacePath: string, agentId: string, candidate: string): string | null {
  const counterpart = counterpartWorkspaceRoot(workspacePath, agentId);
  if (counterpart === null || counterpart === workspacePath || !isWithin(counterpart, candidate)) return null;
  return join(workspacePath, relative(counterpart, candidate));
}

function counterpartWorkspaceRoot(workspacePath: string, agentId: string): string | null {
  const parent = dirname(workspacePath);
  const legacyId = legacyAgentId(agentId);
  if (basename(workspacePath) === agentId && basename(parent) === "Agents") {
    return join(dirname(parent), "Bots", legacyId);
  }
  if (basename(workspacePath) === legacyId && basename(parent) === "Bots") {
    return join(dirname(parent), "Agents", agentId);
  }
  return null;
}

export function isWithin(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return (
    relativePath !== "" && relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath)
  );
}

function decodePath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
export const resolveSharedFile = Effect.fn("Workspace.resolveSharedFile")(function* (
  sharedRootPath: string,
  inputPath: string,
  options: { allowDirectory?: boolean; followLinks?: boolean } = {},
): Effect.fn.Return<ResolvedSharedFile, AttachmentOperationError> {
  const sharedRoot = yield* attachmentCall(() => realpath(sharedRootPath));
  const candidatePath = resolve(sharedPathFromInput(sharedRootPath, inputPath));
  const resolvedPath = yield* attachmentCall(() => realpath(candidatePath)).pipe(
    Effect.catch((error) => {
      const withoutLocation = candidatePath.replace(LOCATION_SUFFIX, "");
      if (!isMissing(error) || withoutLocation === candidatePath) return Effect.fail(error);
      return attachmentCall(() => realpath(withoutLocation));
    }),
  );
  const writtenInside =
    options.followLinks === true && [sharedRootPath, sharedRoot].some((root) => isWithin(resolve(root), candidatePath));
  if (!writtenInside && !isWithin(sharedRoot, resolvedPath)) {
    return yield* attachmentFailure(new Error(sourceText("error.backend.sharedFileOutside")));
  }
  const metadata = yield* attachmentCall(() => stat(resolvedPath));
  if (metadata.isDirectory() && !options.allowDirectory) {
    return yield* attachmentFailure(new Error(sourceText("error.backend.sharedPathIsFolder")));
  }
  if (!metadata.isFile() && !metadata.isDirectory()) {
    return yield* attachmentFailure(new Error(sourceText("error.backend.sharedPathNotFile")));
  }
  return { path: resolvedPath, name: basename(resolvedPath), size: metadata.size };
});
export class WorkspacePathRefused extends Error {
  constructor(
    readonly reason: "missing" | "outside" | "not-file" | "not-directory",
    message: string,
    readonly memberMessage = message,
  ) {
    super(message);
  }
}

function refuse(reason: WorkspacePathRefused["reason"], message: string, memberMessage?: string) {
  return Effect.fail(attachmentFailure(new WorkspacePathRefused(reason, message, memberMessage)));
}

interface WorkspacePathAccess {
  allowOutside?: boolean;
  allowedRoots?: readonly string[];
}

const WORK_FOLDER_LIMIT = 50;

interface ToolHistory {
  fileHistory?: readonly string[];
  workFolders?: readonly string[];
}

const resolveWorkspacePath = Effect.fn("Workspace.resolveWorkspacePath")(function* (
  agent: Pick<AgentSummary, "id" | "workspacePath">,
  inputPath: string,
  options: WorkspacePathAccess & { allowRoot?: boolean; exactPath?: boolean } & ToolHistory,
) {
  const workspaceRoot = yield* attachmentCall(() => realpath(agent.workspacePath));
  const candidatePath = workspacePathFromInput(agent.workspacePath, agent.id, inputPath);
  const memberMessage = sourceText("error.backend.workspacePathMissingForMember", { path: inputPath });
  const readAllowedRoots = yield* Effect.cached(realRoots(options.allowedRoots ?? []));
  const resolvedPath = yield* realpathWithLegacyRoot(agent, candidatePath).pipe(
    Effect.catch((error) => {
      const withoutLocation = candidatePath.replace(LOCATION_SUFFIX, "");
      if (!isMissing(error) || withoutLocation === candidatePath) return Effect.fail(error);
      return realpathWithLegacyRoot(agent, withoutLocation);
    }),
    Effect.catch((error) => {
      if (!isMissing(error) || options.exactPath) return Effect.fail(error);
      const requestedPath = decodePath(inputPath.trim());
      if (isAbsolute(requestedPath) || requestedPath.replaceAll("\\", "/").startsWith("~/")) return Effect.fail(error);
      return findOutsideWorkspace(agent, workspaceRoot, candidatePath, requestedPath, readAllowedRoots, options).pipe(
        Effect.flatMap((found) => (found === null ? Effect.fail(error) : Effect.succeed(found))),
      );
    }),
    Effect.catch((error) =>
      isMissing(error)
        ? refuse(
            "missing",
            sourceText("error.backend.workspacePathMissing", {
              path: homeRelative(inputPath),
              root: homeRelative(agent.workspacePath),
            }),
            memberMessage,
          )
        : Effect.fail(error),
    ),
  );
  const insideWorkspace =
    isWithin(workspaceRoot, resolvedPath) || (options.allowRoot === true && resolvedPath === workspaceRoot);
  const allowedRoots = insideWorkspace || options.allowOutside ? [] : yield* readAllowedRoots;
  const mayAccess = accessCheck(workspaceRoot, allowedRoots, options);
  if (!insideWorkspace && !mayAccess(resolvedPath)) {
    return yield* refuse("outside", sourceText("error.backend.workspaceFileOutside"), memberMessage);
  }
  const metadata = yield* attachmentCall(() => stat(resolvedPath));
  return { workspaceRoot, mayAccess, resolvedPath, insideWorkspace, metadata };
});

function realRoots(roots: readonly string[]) {
  return Effect.forEach(roots, (root) => attachmentCall(() => realpath(root)).pipe(Effect.orElseSucceed(() => null)), {
    concurrency: "unbounded",
  }).pipe(Effect.map((found) => found.filter((root): root is string => root !== null)));
}

function accessCheck(workspaceRoot: string, allowedRoots: readonly string[], options: WorkspacePathAccess) {
  return (path: string) =>
    options.allowOutside === true ||
    isWithin(workspaceRoot, path) ||
    allowedRoots.some((root) => root === path || isWithin(root, path));
}

const findOutsideWorkspace = Effect.fn("Workspace.findOutsideWorkspace")(function* (
  agent: Pick<AgentSummary, "workspacePath">,
  workspaceRoot: string,
  candidatePath: string,
  requestedPath: string,
  readAllowedRoots: Effect.Effect<string[]>,
  options: WorkspacePathAccess & ToolHistory,
): Effect.fn.Return<string | null, AttachmentOperationError> {
  const allowedRoots = yield* readAllowedRoots;
  const mayAccess = accessCheck(workspaceRoot, allowedRoots, options);
  const relativePath = isWithin(agent.workspacePath, candidatePath)
    ? relative(agent.workspacePath, candidatePath)
    : null;
  const relativePaths = relativePath === null ? [] : withLocationVariants(relativePath);
  const inAddedFolder = yield* onlyMatch(allowedRoots, relativePaths, mayAccess);
  if (inAddedFolder !== null) return inAddedFolder;
  const historyEndings =
    relativePath === null ? withLocationVariants(withoutLeadingParents(requestedPath)) : relativePaths;
  const history = [...(options.fileHistory ?? [])].reverse();
  const historyPaths = new Set(
    historyEndings.flatMap((linkPath) => history.filter((path) => endsWithPath(path, linkPath))),
  );
  for (const historyPath of historyPaths) {
    const found = yield* Effect.result(attachmentCall(() => realpath(historyPath)));
    if (Result.isSuccess(found) && mayAccess(found.success)) return found.success;
    if (Result.isFailure(found) && !isMissing(found.failure) && options.allowOutside)
      return yield* Effect.fail(found.failure);
  }
  const workFolders = [...new Set([...(options.workFolders ?? [])].reverse())].slice(0, WORK_FOLDER_LIMIT);
  return yield* onlyMatch(workFolders, relativePaths, mayAccess);
});

function withLocationVariants(path: string): string[] {
  return path === "" ? [] : [...new Set([path, path.replace(LOCATION_SUFFIX, "")])];
}

function withoutLeadingParents(path: string): string {
  const parts = normalize(path.replaceAll("\\", "/")).split(sep);
  const first = parts.findIndex((part) => part !== ".." && part !== ".");
  return first === -1 ? "" : parts.slice(first).join(sep);
}

function endsWithPath(path: string, ending: string): boolean {
  const normalized = normalize(path);
  return normalized === ending || normalized.endsWith(`${sep}${ending}`);
}

const onlyMatch = Effect.fn("Workspace.onlyMatch")(function* (
  folders: readonly string[],
  relativePaths: readonly string[],
  mayAccess: (path: string) => boolean,
) {
  if (relativePaths.length === 0) return null;
  const matches = yield* Effect.forEach(
    folders,
    (folder) =>
      Effect.gen(function* () {
        for (const path of relativePaths) {
          const found = yield* Effect.result(attachmentCall(() => realpath(join(folder, path))));
          if (Result.isSuccess(found) && mayAccess(found.success)) return found.success;
        }
        return null;
      }),
    { concurrency: "unbounded" },
  );
  const files = new Set(matches.filter((path): path is string => path !== null));
  return files.size === 1 ? ([...files][0] ?? null) : null;
});

function homeRelative(path: string): string {
  const home = homedir();
  return path === home || path.startsWith(`${home}${sep}`) ? `~${path.slice(home.length)}` : path;
}

function isMissing(error: AttachmentOperationError): boolean {
  return isRecord(error.cause) && (error.cause.code === "ENOENT" || error.cause.code === "ENOTDIR");
}

export const resolveWorkspaceFile = Effect.fn("Workspace.resolveWorkspaceFile")(function* (
  agent: Pick<AgentSummary, "id" | "workspacePath">,
  inputPath: string,
  options: WorkspacePathAccess & { exactPath?: boolean } & ToolHistory = {},
): Effect.fn.Return<ResolvedWorkspaceFile, AttachmentOperationError> {
  const { resolvedPath, insideWorkspace, metadata } = yield* resolveWorkspacePath(agent, inputPath, options);
  if (!metadata.isFile()) return yield* refuse("not-file", sourceText("error.backend.workspacePathNotFile"));
  return { path: resolvedPath, name: basename(resolvedPath), size: metadata.size, insideWorkspace };
});

export const listWorkspaceDirectory = Effect.fn("Workspace.listWorkspaceDirectory")(function* (
  agent: Pick<AgentSummary, "id" | "workspacePath">,
  inputPath: string,
  options: WorkspacePathAccess = {},
): Effect.fn.Return<WorkspaceDirectory, AttachmentOperationError> {
  const { workspaceRoot, mayAccess, resolvedPath, insideWorkspace, metadata } = yield* resolveWorkspacePath(
    agent,
    inputPath,
    { ...options, allowRoot: true },
  );
  if (!metadata.isDirectory())
    return yield* refuse("not-directory", sourceText("error.backend.workspacePathNotDirectory"));
  const encode = (path: string) => path.split(sep).map(encodeURIComponent).join("/");
  const pathFor = (path: string) => {
    if (!insideWorkspace) return encode(path);
    const inside = relative(workspaceRoot, path);
    return inside ? `./${encode(inside)}` : ".";
  };
  const dirents = yield* attachmentCall(() => readdir(resolvedPath, { withFileTypes: true }));
  const candidates: { name: string; target: string; kind: WorkspaceDirectoryEntry["kind"] }[] = [];
  for (const dirent of dirents) {
    if (dirent.name.includes("\\")) continue;
    const entryPath = join(resolvedPath, dirent.name);
    if (dirent.isDirectory() || dirent.isFile()) {
      candidates.push({ name: dirent.name, target: entryPath, kind: dirent.isDirectory() ? "directory" : "file" });
      continue;
    }
    if (!dirent.isSymbolicLink()) continue;
    const target = yield* attachmentCall(() => realpath(entryPath)).pipe(Effect.orElseSucceed(() => null));
    if (target === null || !mayAccess(target)) continue;
    const linked = yield* attachmentCall(() => stat(target)).pipe(Effect.orElseSucceed(() => null));
    if (linked?.isDirectory() || linked?.isFile())
      candidates.push({ name: dirent.name, target, kind: linked.isDirectory() ? "directory" : "file" });
  }
  candidates.sort((left, right) =>
    left.kind === right.kind ? left.name.localeCompare(right.name) : left.kind === "directory" ? -1 : 1,
  );
  const shown = yield* Effect.forEach(
    candidates.slice(0, WORKSPACE_DIRECTORY_LIMIT),
    (candidate) =>
      attachmentCall(() => stat(candidate.target)).pipe(
        Effect.map(
          (metadata): WorkspaceDirectoryEntry => ({
            name: candidate.name,
            path: pathFor(join(resolvedPath, candidate.name)),
            kind: candidate.kind,
            size: candidate.kind === "file" ? metadata.size : 0,
            modifiedAt: Math.max(0, Math.floor(metadata.mtimeMs)),
          }),
        ),
        Effect.orElseSucceed(() => null),
      ),
    { concurrency: 16 },
  );
  const parent = dirname(resolvedPath);
  return {
    name: resolvedPath === workspaceRoot ? basename(agent.workspacePath) : basename(resolvedPath),
    path: pathFor(resolvedPath),
    root: agent.workspacePath,
    parentPath:
      resolvedPath === workspaceRoot || parent === resolvedPath || (!insideWorkspace && !mayAccess(parent))
        ? null
        : pathFor(parent),
    entries: shown.filter(
      (entry): entry is WorkspaceDirectoryEntry => entry !== null && entry.path.length <= INPUT_LIMITS.path,
    ),
    truncated: candidates.length > WORKSPACE_DIRECTORY_LIMIT,
  };
});

const realpathWithLegacyRoot = Effect.fn("Workspace.realpathWithLegacyRoot")(function* (
  agent: Pick<AgentSummary, "id" | "workspacePath">,
  candidatePath: string,
): Effect.fn.Return<string, AttachmentOperationError> {
  return yield* attachmentCall(() => realpath(candidatePath)).pipe(
    Effect.catch((error) => {
      const rebased =
        isRecord(error.cause) && error.cause.code === "ENOENT"
          ? rebaseLegacyWorkspacePath(agent.workspacePath, agent.id, candidatePath)
          : null;
      return rebased === null ? Effect.fail(error) : attachmentCall(() => realpath(rebased));
    }),
  );
});
