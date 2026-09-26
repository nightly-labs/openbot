import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readlink, realpath, rename, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { HookCallbackMatcher, Options, SdkPluginConfig } from "@anthropic-ai/claude-agent-sdk";
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
 *
 * The files in `.claude` of the workspace are not trusted: a Codex agent can write them before a
 * switch to Claude, because Codex cannot deny one path in a writable root while it takes a sandbox
 * mode. Their `sandbox.filesystem.allowWrite`, `Edit(...)` rules and hooks would widen this sandbox or
 * run outside it. So the query loads the user settings only, the workspace skills come back through
 * `claudeWorkspaceSkillPlugin`, and `CLAUDE_WORKSPACE_MANAGED_SETTINGS` stops the hooks of settings
 * and skills.
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

/**
 * Only the hooks of managed settings run, and OpenBot gives none. The SDK hook of
 * `claudeWorkspaceHooks` still runs. A hook in the frontmatter of a workspace skill does not.
 */
export const CLAUDE_WORKSPACE_MANAGED_SETTINGS: NonNullable<Options["managedSettings"]> = {
  allowManagedHooksOnly: true,
};

/**
 * A plugin named `openbot` whose `skills` links to `.claude/skills` of the workspace, because Claude
 * reads that folder only with the project settings. Claude lists each skill as `openbot:<name>` and
 * `/<name>` still works. The plugin folder is in `stateDirectory`, outside every root the agent can
 * write: a plugin can also start hooks and language servers, which run outside the sandbox.
 */
export async function claudeWorkspaceSkillPlugin(stateDirectory: string, cwd: string): Promise<SdkPluginConfig> {
  const directory = join(stateDirectory, "claude-skill-plugins", createHash("sha256").update(cwd).digest("hex"));
  await mkdir(join(directory, ".claude-plugin"), { recursive: true, mode: 0o700 });
  await writeFile(join(directory, ".claude-plugin", "plugin.json"), `${JSON.stringify({ name: "openbot" })}\n`);
  const link = join(directory, "skills");
  const target = join(cwd, ".claude", "skills");
  if ((await currentLink(link)) !== target) {
    // A link made aside and renamed over the old one, so a query that starts at the same time never
    // sees the plugin without its skills.
    const staged = `${link}.${randomUUID()}`;
    await symlink(target, staged, "junction");
    await rename(staged, link);
  }
  return { type: "local", path: directory };
}

async function currentLink(path: string): Promise<string | null> {
  try {
    return await readlink(path);
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
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
 * resolved counts as outside. Claude's own settings files in a root count as outside too: Workspace
 * only ignores them, but a Full access session or Claude in a terminal loads them and runs their hooks.
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
