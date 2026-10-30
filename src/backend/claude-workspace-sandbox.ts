import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readlink, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { HookCallbackMatcher, Options, SdkPluginConfig } from "@anthropic-ai/claude-agent-sdk";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { Effect, Result } from "effect";
import { workspaceTemporaryPaths } from "./agent/workspace-sandbox";
import { runCauseEffect } from "./effect-boundary";
import { isMissingFileError } from "./file-errors";
import { listHomeSkills, skillFolderNames } from "./home-skills";
import { isPathInside } from "./path-containment";
import { type ProviderClientOperationError, providerCall, providerFailure } from "./provider-client-effects";

/**
 * Workspace only for Claude has two parts, because the Claude sandbox covers Bash and nothing else.
 *
 * - Bash runs in the Claude sandbox, which lets it write only in the roots and the temporary folders. `failIfUnavailable` stops
 *   the query when the computer cannot make that sandbox, and no command may leave it.
 * - The file tools do not run in that sandbox. A `PreToolUse` hook returns `ask` for a write outside
 *   the roots and the temporary folders. Unlike `canUseTool`, a hook runs even when an allow rule in the user's Claude settings
 *   matches the tool, and `ask` then sends the write to `canUseTool`, which asks the user.
 *
 * Reads, the network and the MCP servers stay open, as the Access setting says. The folders that the
 * user excluded are denied in both parts: the sandbox denies Bash writes there, and the hook denies a
 * file tool's write there with no question to the user.
 *
 * The files in `.claude` of the workspace are not trusted: a Codex agent can write them before a
 * switch to Claude, because Codex cannot deny one path in a writable root while it takes a sandbox
 * mode. The Grok and OpenCode sandboxes deny them. Their `sandbox.filesystem.allowWrite`, `Edit(...)`
 * rules and hooks would widen this sandbox or run outside it. So the query loads the user settings
 * only, the workspace skills come back through `claudeWorkspaceSkillPlugin`, and
 * `CLAUDE_WORKSPACE_MANAGED_SETTINGS` stops the hooks of settings and skills.
 */
export function claudeWorkspaceSandbox(
  roots: readonly string[],
  excluded: readonly string[] = [],
): NonNullable<Options["sandbox"]> {
  return {
    enabled: true,
    failIfUnavailable: true,
    autoAllowBashIfSandboxed: true,
    allowUnsandboxedCommands: false,
    filesystem: { allowWrite: writableRoots(roots), ...(excluded.length ? { denyWrite: [...excluded] } : {}) },
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
export const claudeWorkspaceSkillPlugin = Effect.fn("ClaudeWorkspace.skillPlugin")(function* (
  stateDirectory: string,
  cwd: string,
): Effect.fn.Return<SdkPluginConfig, ProviderClientOperationError> {
  const directory = join(stateDirectory, "claude-skill-plugins", createHash("sha256").update(cwd).digest("hex"));
  yield* providerCall(() => mkdir(join(directory, ".claude-plugin"), { recursive: true, mode: 0o700 }));
  yield* providerCall(() =>
    writeFile(join(directory, ".claude-plugin", "plugin.json"), `${JSON.stringify({ name: "openbot" })}\n`),
  );
  const link = join(directory, "skills");
  const target = join(cwd, ".claude", "skills");
  if ((yield* currentLink(link)) !== target) {
    // A link made aside and renamed over the old one, so a query that starts at the same time never
    // sees the plugin without its skills.
    const staged = `${link}.${randomUUID()}`;
    yield* providerCall(() => symlink(target, staged, "junction"));
    yield* providerCall(() => rename(staged, link));
  }
  return { type: "local", path: directory };
});

/**
 * A plugin named `agents` with the user's skills in `~/.agents/skills`, because Claude does not read
 * that folder. A skill that Claude already reads from `<configDirectory>/skills` or `.claude/skills`
 * of the workspace is left out, so a skill that `npx skills` linked into both folders is listed once.
 * Claude lists each skill as `agents:<name>`, and `/<name>` still works. Each set of skills has a
 * folder of its own, named by its hash and never changed, so a query that runs keeps its skills when
 * the next one gets another set. Null when no skill is left.
 */
export const claudeHomeSkillPlugin = Effect.fn("ClaudeWorkspace.homeSkillPlugin")(function* (
  stateDirectory: string,
  configDirectory: string,
  cwd: string,
): Effect.fn.Return<SdkPluginConfig | null, ProviderClientOperationError> {
  const read = new Set([
    ...(yield* skillFolderNames(join(configDirectory, "skills"))),
    ...(yield* skillFolderNames(join(cwd, ".claude", "skills"))),
  ]);
  const skills = (yield* listHomeSkills()).filter((skill) => !read.has(skill.slug));
  if (skills.length === 0) return null;
  const hash = createHash("sha256")
    .update(skills.map((skill) => skill.directory).join("\0"))
    .digest("hex");
  const directory = join(stateDirectory, "claude-skill-plugins", `home-${hash}`);
  const manifest = join(directory, ".claude-plugin", "plugin.json");
  if (yield* pathExists(manifest)) return { type: "local", path: directory };
  // Made aside and renamed into place, so a query never sees a plugin without all its skills.
  const staged = `${directory}.${randomUUID()}`;
  yield* providerCall(() => mkdir(join(staged, ".claude-plugin"), { recursive: true, mode: 0o700 }));
  yield* providerCall(() =>
    writeFile(join(staged, ".claude-plugin", "plugin.json"), `${JSON.stringify({ name: "agents" })}\n`),
  );
  yield* providerCall(() => mkdir(join(staged, "skills")));
  for (const skill of skills)
    yield* providerCall(() => symlink(skill.directory, join(staged, "skills", skill.slug), "junction"));
  const moved = yield* Effect.result(providerCall(() => rename(staged, directory)));
  if (Result.isFailure(moved)) {
    // A query that started at the same time made the same folder first.
    yield* providerCall(() => rm(staged, { recursive: true, force: true }));
    if (!(yield* pathExists(manifest))) return yield* Effect.fail(moved.failure);
  }
  return { type: "local", path: directory };
});

const pathExists = Effect.fn("ClaudeWorkspace.pathExists")((path: string) =>
  providerCall(() => lstat(path)).pipe(
    Effect.as(true),
    Effect.catch((error) => (isMissingFileError(error.cause) ? Effect.succeed(false) : Effect.fail(error))),
  ),
);

const currentLink = Effect.fn("ClaudeWorkspace.currentLink")((path: string) =>
  providerCall(() => readlink(path)).pipe(
    Effect.catch((error) => (isMissingFileError(error.cause) ? Effect.succeed(null) : Effect.fail(error))),
  ),
);

const WRITE_TOOLS = ["Write", "Edit", "MultiEdit", "NotebookEdit"];

/**
 * The `PreToolUse` hook that denies a file tool's write in an excluded folder and sends one outside
 * the roots to `canUseTool`.
 */
export function claudeWorkspaceHooks(
  cwd: string,
  roots: readonly string[],
  excluded: readonly string[] = [],
): NonNullable<Options["hooks"]> {
  const matcher: HookCallbackMatcher = {
    matcher: WRITE_TOOLS.join("|"),
    hooks: [
      async (input) => {
        if (input.hook_event_name !== "PreToolUse") return {};
        const denied = await runCauseEffect(claudeWriteInExcluded(input.tool_name, input.tool_input, cwd, excluded));
        if (denied)
          return {
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason: claudeExcludedWriteMessage(denied),
            },
          };
        const target = await runCauseEffect(claudeWriteOutsideRoots(input.tool_name, input.tool_input, cwd, roots));
        if (!target) return {};
        return {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "ask",
            permissionDecisionReason: `Workspace only: ${target} is outside the agent's workspace, the shared folder, the folders the user gave it and the temporary folders.`,
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
export const claudeWriteOutsideRoots = Effect.fn("ClaudeWorkspace.writeOutsideRoots")(function* (
  toolName: string,
  toolInput: unknown,
  cwd: string,
  roots: readonly string[],
) {
  if (!WRITE_TOOLS.includes(toolName)) return null;
  const path = isDynamicRecord(toolInput) ? writePath(toolInput.file_path ?? toolInput.notebook_path) : null;
  if (!path) return "an unknown path";
  return yield* Effect.gen(function* () {
    const target = yield* resolveExisting(resolve(cwd, path));
    if (isClaudeSettingsFile(target)) return path;
    const realRoots = yield* Effect.forEach(writableRoots(roots), (root) => resolveExisting(resolve(root)), {
      concurrency: "unbounded",
    });
    return realRoots.some((root) => isPathInside(root, target)) ? null : path;
  }).pipe(Effect.catch(() => Effect.succeed(path)));
});

/** What Claude reads when the hook or `canUseTool` denies a write in an excluded folder. */
export function claudeExcludedWriteMessage(path: string): string {
  return `Workspace only: the user excluded the folder that holds ${path}. Do not write there.`;
}

/**
 * The path a file tool would write in an excluded folder, or null. A path that cannot be resolved
 * counts as in one when there are excluded folders, the same as `claudeWriteOutsideRoots`.
 */
export const claudeWriteInExcluded = Effect.fn("ClaudeWorkspace.writeInExcluded")(function* (
  toolName: string,
  toolInput: unknown,
  cwd: string,
  excluded: readonly string[],
) {
  if (excluded.length === 0 || !WRITE_TOOLS.includes(toolName)) return null;
  const path = isDynamicRecord(toolInput) ? writePath(toolInput.file_path ?? toolInput.notebook_path) : null;
  if (!path) return null;
  return yield* Effect.gen(function* () {
    const target = yield* resolveExisting(resolve(cwd, path));
    const realExcluded = yield* Effect.forEach(excluded, (folder) => resolveExisting(resolve(folder)), {
      concurrency: "unbounded",
    });
    return realExcluded.some((folder) => isPathInside(folder, target)) ? path : null;
  }).pipe(Effect.catch(() => Effect.succeed(path)));
});

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
const resolveExisting = Effect.fn("ClaudeWorkspace.resolveExisting")(function* (
  path: string,
  links = 0,
): Effect.fn.Return<string, ProviderClientOperationError> {
  const real = yield* Effect.result(providerCall(() => realpath(path)));
  if (Result.isSuccess(real)) return real.success;
  if (!isMissingFileError(real.failure.cause)) return yield* real.failure;
  const info = yield* Effect.result(providerCall(() => lstat(path)));
  if (Result.isFailure(info)) {
    if (!isMissingFileError(info.failure.cause)) return yield* info.failure;
    const parent = dirname(path);
    return parent === path ? path : resolve(yield* resolveExisting(parent, links), basename(path));
  }
  if (!info.success.isSymbolicLink() || links >= MAX_LINKS)
    return yield* providerFailure(new Error(`Cannot resolve ${path}.`));
  const target = yield* providerCall(() => readlink(path));
  return yield* resolveExisting(resolve(dirname(path), target), links + 1);
});
