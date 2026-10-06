import { readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type AgentSummary,
  WORKSPACE_DIRECTORY_LIMIT,
  type WorkspaceDirectory,
  type WorkspaceDirectoryEntry,
} from "@openbot/contracts/ipc";
import { legacyAgentId } from "@openbot/contracts/validation";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
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

/** A line or column reference that agents write after a path: `:12`, `:12:3`, `#L12`, `#L12-L20`, `#L12C3`. */
const LOCATION_SUFFIX = /(?::\d+(?::\d+)?|#L\d+(?:C\d+)?(?:-L?\d+(?:C\d+)?)?)$/u;

export function sharedPathFromInput(sharedRoot: string, inputPath: string): string {
  const normalized = inputPath.replaceAll("\\", "/");
  for (const prefix of ["~/OpenBot/Shared/", "OpenBot/Shared/", "Shared/"]) {
    if (normalized.startsWith(prefix)) return join(sharedRoot, normalized.slice(prefix.length));
  }
  return isAbsolute(inputPath) ? inputPath : join(sharedRoot, normalized);
}

/**
 * The two `Bots` prefixes are permanent. This function reads paths the model writes and paths quoted in
 * messages, and the workspace root was `~/OpenBot/Bots/bot-<uuid>` in every release before the
 * bot-to-agent rename. A database restored from the user's own copy of the file never ran migration v13,
 * so it still spells both the id and the path that way; and a cross-device root legitimately leaves a
 * workspace under the old name even after v13. Dropping the prefix does not fail loudly -- the path just
 * resolves somewhere else.
 */
export function workspacePathFromInput(workspaceRoot: string, agentId: string, inputPath: string): string {
  const decoded = decodePath(inputPath.trim());
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

/**
 * An absolute path under this agent's pre-rename workspace root, rebased onto its current one, or `null`
 * if it is not one. The provider keeps its own transcript behind `external_session_id`, and migration v13
 * cannot reach into it, so a resumed thread can still hand back a path it wrote before the workspace
 * moved. Callers try this only after the original path is gone, and put the result through the same
 * {@link isWithin} containment check as any other candidate -- the fallback finds the file again, it does
 * not open a second way out of the workspace.
 */
export function rebaseLegacyWorkspacePath(workspacePath: string, agentId: string, candidate: string): string | null {
  const counterpart = counterpartWorkspaceRoot(workspacePath, agentId);
  if (counterpart === null || counterpart === workspacePath || !isWithin(counterpart, candidate)) return null;
  return join(workspacePath, relative(counterpart, candidate));
}

/**
 * The other root this agent's workspace could be sitting under -- the pre-rename one when the move
 * succeeded, and the post-rename one when it did not. The move gives up on `EXDEV` or a permission error
 * and leaves the directory where it was, but migration v13 has already rewritten the paths inside that
 * agent's messages to where it *would* have gone, so the fallback has to run in both directions or those
 * links stay broken for exactly the users whose move failed.
 */
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
  return relativePath !== "" && !relativePath.startsWith("..") && !isAbsolute(relativePath);
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
): Effect.fn.Return<ResolvedSharedFile, AttachmentOperationError> {
  const sharedRoot = yield* attachmentCall(() => realpath(sharedRootPath));
  const candidatePath = sharedPathFromInput(sharedRootPath, inputPath);
  const resolvedPath = yield* attachmentCall(() => realpath(candidatePath));
  if (!isWithin(sharedRoot, resolvedPath)) {
    return yield* attachmentFailure(new Error(sourceText("error.backend.sharedFileOutside")));
  }
  const metadata = yield* attachmentCall(() => stat(resolvedPath));
  if (!metadata.isFile()) return yield* attachmentFailure(new Error(sourceText("error.backend.sharedPathNotFile")));
  return { path: resolvedPath, name: basename(resolvedPath), size: metadata.size };
});
/**
 * Why a workspace path was refused. The cause of the failure, so the Team API can answer each with its
 * own status and a remote member reads the sentence instead of a generic server error. `memberMessage`
 * is the sentence for a remote member: it does not name the absolute workspace path of the host.
 */
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

/** Resolves a path that a message or the model wrote to a real path, with the workspace containment check. */
const resolveWorkspacePath = Effect.fn("Workspace.resolveWorkspacePath")(function* (
  agent: Pick<AgentSummary, "id" | "workspacePath">,
  inputPath: string,
  options: { allowOutside?: boolean; allowRoot?: boolean },
) {
  const workspaceRoot = yield* attachmentCall(() => realpath(agent.workspacePath));
  const candidatePath = workspacePathFromInput(agent.workspacePath, agent.id, inputPath);
  // A member reads one sentence for a path that is missing and for a path outside the workspace, so
  // the answer does not tell whether a path exists on the host.
  const memberMessage = sourceText("error.backend.workspacePathMissingForMember", { path: inputPath });
  const resolvedPath = yield* realpathWithLegacyRoot(agent, candidatePath).pipe(
    Effect.catch((error) => {
      // The literal path goes first, so a real file named `notes:2` still opens.
      const withoutLocation = candidatePath.replace(LOCATION_SUFFIX, "");
      if (!isMissing(error) || withoutLocation === candidatePath) return Effect.fail(error);
      return realpathWithLegacyRoot(agent, withoutLocation);
    }),
    Effect.catch((error) =>
      isMissing(error)
        ? refuse(
            "missing",
            sourceText("error.backend.workspacePathMissing", { path: inputPath, root: agent.workspacePath }),
            memberMessage,
          )
        : Effect.fail(error),
    ),
  );
  const insideWorkspace =
    isWithin(workspaceRoot, resolvedPath) || (options.allowRoot === true && resolvedPath === workspaceRoot);
  if (!insideWorkspace && !options.allowOutside) {
    return yield* refuse("outside", sourceText("error.backend.workspaceFileOutside"), memberMessage);
  }
  const metadata = yield* attachmentCall(() => stat(resolvedPath));
  return { workspaceRoot, resolvedPath, insideWorkspace, metadata };
});

function isMissing(error: AttachmentOperationError): boolean {
  return isRecord(error.cause) && error.cause.code === "ENOENT";
}

export const resolveWorkspaceFile = Effect.fn("Workspace.resolveWorkspaceFile")(function* (
  agent: Pick<AgentSummary, "id" | "workspacePath">,
  inputPath: string,
  options: { allowOutside?: boolean } = {},
): Effect.fn.Return<ResolvedWorkspaceFile, AttachmentOperationError> {
  const { resolvedPath, insideWorkspace, metadata } = yield* resolveWorkspacePath(agent, inputPath, options);
  if (!metadata.isFile()) return yield* refuse("not-file", sourceText("error.backend.workspacePathNotFile"));
  return { path: resolvedPath, name: basename(resolvedPath), size: metadata.size, insideWorkspace };
});

/**
 * One folder of an agent's workspace, for the folder view of a chip. Each entry carries a path that the
 * file and folder routes accept again: relative to the workspace root when it is inside it. A link
 * whose target leaves the workspace is left out when the caller may not go outside, so a remote member
 * cannot read the size and date of a file on the host through it.
 */
export const listWorkspaceDirectory = Effect.fn("Workspace.listWorkspaceDirectory")(function* (
  agent: Pick<AgentSummary, "id" | "workspacePath">,
  inputPath: string,
  options: { allowOutside?: boolean } = {},
): Effect.fn.Return<WorkspaceDirectory, AttachmentOperationError> {
  const { workspaceRoot, resolvedPath, insideWorkspace, metadata } = yield* resolveWorkspacePath(agent, inputPath, {
    ...options,
    allowRoot: true,
  });
  if (!metadata.isDirectory())
    return yield* refuse("not-directory", sourceText("error.backend.workspacePathNotDirectory"));
  // `workspacePathFromInput` trims, decodes `%XX` and expands `~/`. Each segment is encoded and a
  // relative path starts with `./`, so a name such as ` a%20b` or `~` reads back as the same file.
  const encode = (path: string) => path.split(sep).map(encodeURIComponent).join("/");
  const pathFor = (path: string) => {
    if (!insideWorkspace) return encode(path);
    const inside = relative(workspaceRoot, path);
    return inside ? `./${encode(inside)}` : ".";
  };
  const dirents = yield* attachmentCall(() => readdir(resolvedPath, { withFileTypes: true }));
  const candidates: { name: string; target: string; kind: WorkspaceDirectoryEntry["kind"] }[] = [];
  for (const dirent of dirents) {
    const entryPath = join(resolvedPath, dirent.name);
    if (dirent.isDirectory() || dirent.isFile()) {
      candidates.push({ name: dirent.name, target: entryPath, kind: dirent.isDirectory() ? "directory" : "file" });
      continue;
    }
    if (!dirent.isSymbolicLink()) continue;
    // A link is followed for its kind; its target must pass the same containment check as a path.
    const target = yield* attachmentCall(() => realpath(entryPath)).pipe(Effect.orElseSucceed(() => null));
    if (target === null || (!options.allowOutside && !isWithin(workspaceRoot, target))) continue;
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
      // An entry that disappears while the folder is listed is left out.
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
    // A folder outside the workspace is listed only for a caller that may go outside, so its parent is too.
    parentPath: resolvedPath === workspaceRoot || parent === resolvedPath ? null : pathFor(parent),
    // An encoded path can pass the limit that the routes accept again; that entry is left out.
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
      // Apply the same containment check to paths from released provider transcripts.
      const rebased =
        isRecord(error.cause) && error.cause.code === "ENOENT"
          ? rebaseLegacyWorkspacePath(agent.workspacePath, agent.id, candidatePath)
          : null;
      return rebased === null ? Effect.fail(error) : attachmentCall(() => realpath(rebased));
    }),
  );
});
