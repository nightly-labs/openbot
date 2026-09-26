import { realpath } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import type { HookCallbackMatcher, Options } from "@anthropic-ai/claude-agent-sdk";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { isPathInside } from "./path-containment";

/**
 * Workspace only for Claude has two parts, because the Claude sandbox covers Bash and nothing else.
 *
 * - Bash runs in the Claude sandbox, which lets it write only in the roots. `failIfUnavailable` stops
 *   the query when the computer cannot make that sandbox, and no command may leave it.
 * - The file tools do not run in that sandbox. A `PreToolUse` hook returns `ask` for a write outside
 *   the roots. Unlike `canUseTool`, a hook runs even when an allow rule in the user's Claude settings
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
    filesystem: { allowWrite: [...roots] },
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
            permissionDecisionReason: `Workspace only: ${target} is outside the agent's workspace and the shared folder.`,
          },
        };
      },
    ],
  };
  return { PreToolUse: [matcher] };
}

/**
 * The path a file tool would write outside the roots, or null when it writes inside them or is not
 * a file tool. Symbolic links are resolved through the nearest folder that exists, so a link in the
 * workspace that points outside it counts as outside. Claude's own settings files in a root count as
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
  const target = await resolveExisting(resolve(cwd, path));
  if (isClaudeSettingsFile(target)) return path;
  const realRoots = await Promise.all(roots.map((root) => resolveExisting(resolve(root))));
  return realRoots.some((root) => isPathInside(root, target)) ? null : path;
}

function writePath(value: unknown): string | null {
  return isString(value) && value !== "" ? value : null;
}

function isClaudeSettingsFile(path: string): boolean {
  return basename(dirname(path)) === ".claude" && /^settings(\.local)?\.json$/.test(basename(path));
}

/** The real path of `path`, through its nearest folder that exists when the file itself does not. */
async function resolveExisting(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    const parent = dirname(path);
    return parent === path ? path : resolve(await resolveExisting(parent), basename(path));
  }
}
