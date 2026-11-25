import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readlink, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { HookCallbackMatcher, Options, SdkPluginConfig, Settings } from "@anthropic-ai/claude-agent-sdk";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { Effect, Result } from "effect";
import { workspaceTemporaryPaths } from "./agent/workspace-sandbox";
import { runCauseEffect } from "./effect-boundary";
import { isMissingFileError } from "./file-errors";
import { listHomeSkills, skillFolderNames } from "./home-skills";
import { isPathInside } from "./path-containment";
import { type ProviderClientOperationError, providerCall, providerFailure } from "./provider-client-effects";

export function claudeWorkspaceSandbox(
  roots: readonly string[],
  excluded: readonly string[] = [],
): NonNullable<Settings["sandbox"]> {
  return {
    enabled: true,
    failIfUnavailable: true,
    autoAllowBashIfSandboxed: true,
    allowUnsandboxedCommands: false,
    filesystem: { allowWrite: writableRoots(roots), ...(excluded.length ? { denyWrite: [...excluded] } : {}) },
  };
}

export const CLAUDE_WORKSPACE_MANAGED_SETTINGS: NonNullable<Options["managedSettings"]> = {
  allowManagedHooksOnly: true,
};

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
    const staged = `${link}.${randomUUID()}`;
    yield* providerCall(() => symlink(target, staged, "junction"));
    yield* providerCall(() => rename(staged, link));
  }
  return { type: "local", path: directory };
});

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

export function claudeExcludedWriteMessage(path: string): string {
  return `Workspace only: the user excluded the folder that holds ${path}. Do not write there.`;
}

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

const MAX_LINKS = 40;

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
