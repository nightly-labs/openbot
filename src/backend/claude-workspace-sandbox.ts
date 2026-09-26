import { lstat, readlink, realpath } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import type { HookCallbackMatcher, Options } from "@anthropic-ai/claude-agent-sdk";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { workspaceTemporaryPaths } from "./agent/workspace-sandbox";
import { isMissingFileError } from "./file-errors";
import { isPathInside } from "./path-containment";

/**
 * Workspace only for Claude has two parts, because the Claude sandbox covers Bash and nothing else.
 *
 * - Bash runs in the Claude sandbox, which lets it write only in the roots and the temporary folders. `failIfUnavailable` stops
 *   the query when the computer cannot make that sandbox, and no command may leave it.
 * - The file tools do not run in that sandbox. A `PreToolUse` hook returns `ask` for a write outside
 *   the roots and the temporary folders. Unlike `canUseTool`, a hook runs even when an allow rule in the user's Claude settings
 *   matches the tool, and `ask` then sends the write to `canUseTool`, which asks the user.
 *
 * Reads, the network and the MCP servers stay open, as the Access setting says.
 */
export function claudeWorkspaceSandbox(roots: readonly string[]): NonNullable<Options["sandbox"]> {
  return {
    enabled: true,
    failIfUnavailable: true,
    autoAllowBashIfSandboxed: true,
    allowUnsandboxedCommands: false,
    filesystem: { allowWrite: writableRoots(roots) },
  };
}

const WRITE_TOOLS = ["Write", "Edit", "MultiEdit", "NotebookEdit"];

/** The `PreToolUse` hook that sends a file tool's write outside the roots to `canUseTool`. */
export function claudeWorkspaceHooks(cwd: string, roots: readonly string[]): NonNullable<Options["hooks"]> {
  const matcher: HookCallbackMatcher = {
    matcher: WRITE_TOOLS.join("|"),
    hooks: [
      async (input) => {
        if (input.hook_event_name !== "PreToolUse") return {};
        const target = await claudeWriteOutsideRoots(input.tool_name, input.tool_input, cwd, roots);
        if (!target) return {};
        return {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "ask",
            permissionDecisionReason: `Workspace only: ${target} is outside the agent's workspace, the shared folder and the temporary folders.`,
          },
        };
      },
    ],
  };
  return { PreToolUse: [matcher] };
}

/**
 * The path a file tool would write outside the roots and the temporary folders, or null when it writes
 * inside them or is not a file tool. Symbolic links are resolved, also a link to a file that does not
 * exist yet, so a link in the workspace that points outside it counts as outside. A path that cannot be
 * resolved counts as outside. Claude's own settings files in a root count as
 * outside too: an agent that wrote them could give itself more access at the next start.
 */
export async function claudeWriteOutsideRoots(
  toolName: string,
  toolInput: unknown,
  cwd: string,
  roots: readonly string[],
): Promise<string | null> {
  if (!WRITE_TOOLS.includes(toolName)) return null;
  const path = isDynamicRecord(toolInput) ? writePath(toolInput.file_path ?? toolInput.notebook_path) : null;
  // A write tool without a path fails in Claude itself; asking first costs nothing.
  if (!path) return "an unknown path";
  try {
    const target = await resolveExisting(resolve(cwd, path));
    if (isClaudeSettingsFile(target)) return path;
    const realRoots = await Promise.all(writableRoots(roots).map((root) => resolveExisting(resolve(root))));
    return realRoots.some((root) => isPathInside(root, target)) ? null : path;
  } catch {
    return path;
  }
}

function writableRoots(roots: readonly string[]): string[] {
  return [...roots, ...workspaceTemporaryPaths()];
}

function writePath(value: unknown): string | null {
  return isString(value) && value !== "" ? value : null;
}

function isClaudeSettingsFile(path: string): boolean {
  return basename(dirname(path)) === ".claude" && /^settings(\.local)?\.json$/.test(basename(path));
}

/** The same limit as Linux, so a loop of links fails and counts as outside. */
const MAX_LINKS = 40;

/**
 * The real path of `path`. A file that does not exist is resolved through its nearest folder that
 * does, and a link to a file that does not exist through the link's target. It throws for any other
 * error and for a loop of links.
 */
async function resolveExisting(path: string, links = 0): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }
  let isLink: boolean;
  try {
    isLink = (await lstat(path)).isSymbolicLink();
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
    const parent = dirname(path);
    return parent === path ? path : resolve(await resolveExisting(parent, links), basename(path));
  }
  if (!isLink || links >= MAX_LINKS) throw new Error(`Cannot resolve ${path}.`);
  return resolveExisting(resolve(dirname(path), await readlink(path)), links + 1);
}
