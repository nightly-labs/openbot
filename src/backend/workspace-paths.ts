import { realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import type { AgentSummary } from "@openbot/contracts/ipc";
import { legacyAgentId } from "@openbot/contracts/validation";
import { sourceText } from "@openbot/i18n/source";
import { isRecord } from "./protocol";

export interface ResolvedSharedFile {
  path: string;
  name: string;
  size: number;
}

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

export async function resolveSharedFile(sharedRootPath: string, inputPath: string): Promise<ResolvedSharedFile> {
  const sharedRoot = await realpath(sharedRootPath);
  const candidatePath = sharedPathFromInput(sharedRootPath, inputPath);
  const resolvedPath = await realpath(candidatePath);
  if (!isWithin(sharedRoot, resolvedPath)) {
    throw new Error(sourceText("error.backend.sharedFileOutside"));
  }
  const metadata = await stat(resolvedPath);
  if (!metadata.isFile()) throw new Error(sourceText("error.backend.sharedPathNotFile"));
  return { path: resolvedPath, name: basename(resolvedPath), size: metadata.size };
}

export async function resolveWorkspaceFile(
  agent: Pick<AgentSummary, "id" | "workspacePath">,
  inputPath: string,
): Promise<ResolvedSharedFile> {
  const workspaceRoot = await realpath(agent.workspacePath);
  const candidatePath = workspacePathFromInput(agent.workspacePath, agent.id, inputPath);
  const resolvedPath = await realpath(candidatePath).catch(async (error: unknown) => {
    // The file may be one the provider's own transcript still names under this agent's pre-rename
    // workspace root. The containment check below is unchanged and runs on whatever comes back.
    const rebased =
      isRecord(error) && error.code === "ENOENT"
        ? rebaseLegacyWorkspacePath(agent.workspacePath, agent.id, candidatePath)
        : null;
    if (rebased === null) throw error;
    return await realpath(rebased);
  });
  if (!isWithin(workspaceRoot, resolvedPath)) {
    throw new Error(sourceText("error.backend.workspaceFileOutside"));
  }
  const metadata = await stat(resolvedPath);
  if (!metadata.isFile()) throw new Error(sourceText("error.backend.workspacePathNotFile"));
  return { path: resolvedPath, name: basename(resolvedPath), size: metadata.size };
}
