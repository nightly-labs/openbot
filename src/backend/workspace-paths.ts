import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import type { AgentSummary } from "@openbot/contracts/ipc";
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
export const resolveWorkspaceFile = Effect.fn("Workspace.resolveWorkspaceFile")(function* (
  agent: Pick<AgentSummary, "id" | "workspacePath">,
  inputPath: string,
  options: { allowOutside?: boolean } = {},
): Effect.fn.Return<ResolvedWorkspaceFile, AttachmentOperationError> {
  const workspaceRoot = yield* attachmentCall(() => realpath(agent.workspacePath));
  const candidatePath = workspacePathFromInput(agent.workspacePath, agent.id, inputPath);
  const resolvedPath = yield* realpathWithLegacyRoot(agent, candidatePath).pipe(
    Effect.catch((error) => {
      // The literal path goes first, so a real file named `notes:2` still opens.
      const withoutLocation = candidatePath.replace(LOCATION_SUFFIX, "");
      if (!isRecord(error.cause) || error.cause.code !== "ENOENT" || withoutLocation === candidatePath)
        return Effect.fail(error);
      return realpathWithLegacyRoot(agent, withoutLocation);
    }),
  );
  const insideWorkspace = isWithin(workspaceRoot, resolvedPath);
  if (!insideWorkspace && !options.allowOutside) {
    return yield* attachmentFailure(new Error(sourceText("error.backend.workspaceFileOutside")));
  }
  const metadata = yield* attachmentCall(() => stat(resolvedPath));
  if (!metadata.isFile()) return yield* attachmentFailure(new Error(sourceText("error.backend.workspacePathNotFile")));
  return { path: resolvedPath, name: basename(resolvedPath), size: metadata.size, insideWorkspace };
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
