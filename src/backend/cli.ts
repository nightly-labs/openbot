import { execFile, spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, join, posix, resolve, win32 } from "node:path";
import { promisify } from "node:util";
import { type AgentProviderId, agentProviderName } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result } from "effect";
import { type ProviderClientOperationError, providerCall, providerFailure } from "./provider-client-effects";

const execFileAsync = promisify(execFile);
const MINIMUM_CODEX_VERSION = [0, 144, 1] as const;
const MINIMUM_CLAUDE_VERSION = [2, 1, 232] as const;
const MINIMUM_GROK_VERSION = [1, 0, 5] as const;
// The first Cline CLI that OpenBot was checked with: its sessions run in-process and it answers a lost
// session with the ACP resource-not-found error.
const MINIMUM_CLINE_VERSION = [3, 0, 68] as const;

export interface CodexCliInfo {
  executable: string;
  version: string;
  source: "system" | "managed";
}

export interface ClaudeCliInfo {
  executable: string;
  version: string;
  source?: "system" | "managed";
}

export interface GrokCliInfo {
  executable: string;
  version: string;
  source?: "system" | "managed";
}

export interface OpencodeCliInfo {
  executable: string;
  version: string;
  source?: "system" | "managed";
}

export interface AntigravityCliInfo {
  executable: string;
  version: string;
  source?: "system" | "managed";
}

export interface CursorCliInfo {
  executable: string;
  version: string;
  source?: "system" | "managed";
}

export interface ClineCliInfo {
  executable: string;
  version: string;
  source?: "system" | "managed";
}

export type AgentCliInfo =
  | CodexCliInfo
  | ClaudeCliInfo
  | GrokCliInfo
  | OpencodeCliInfo
  | AntigravityCliInfo
  | CursorCliInfo
  | ClineCliInfo;

export class CodexCliError extends Error {
  constructor(
    message: string,
    readonly code: "missing" | "invalid" | "outdated" | "timeout",
  ) {
    super(message);
    this.name = "CodexCliError";
  }
}

/**
 * The managed CLI OpenBot downloaded for each provider, keyed by provider id. `null` means OpenBot
 * has no managed copy and only the user's own installation is used. A missing key means the same as
 * an unset option: the resolver looks for the copy shipped inside the application itself.
 */
export type BundledProviderExecutables = Partial<Record<AgentProviderId, string | null>>;

export const resolveCodexCli: (input?: {
  systemCandidates?: string[];
  bundledExecutable?: string | null;
}) => Effect.Effect<CodexCliInfo, ProviderClientOperationError> = Effect.fn("Cli.resolveCodexCli")(
  function* (
    input: { systemCandidates?: string[]; bundledExecutable?: string | null } = {},
  ): Effect.fn.Return<CodexCliInfo, ProviderClientOperationError> {
    const bundledExecutable =
      input.bundledExecutable === undefined ? bundledCodexExecutable() : input.bundledExecutable;
    const candidates = yield* cliCandidates("codex", input.systemCandidates, bundledExecutable);
    const failures: CodexCliError[] = [];

    for (const candidate of candidates) {
      if (!(yield* isExecutable(candidate.executable))) continue;

      const attempt = yield* Effect.result(
        Effect.gen(function* () {
          const stdout = yield* readCliVersion(candidate.executable, "codex");
          const version = parseCodexVersion(stdout);
          if (!isMinimumVersion(version, MINIMUM_CODEX_VERSION)) {
            throw new CodexCliError(sourceText("error.provider.codexOutdated", { version }), "outdated");
          }

          return { executable: candidate.executable, version, source: candidate.source };
        }).pipe(Effect.catchDefect((cause) => Effect.fail(providerFailure(cause)))),
      );
      if (Result.isSuccess(attempt)) return attempt.success;
      const error = attempt.failure.cause;

      if (isCliTimeout(error)) throw error;
      failures.push(
        error instanceof CodexCliError
          ? error
          : new CodexCliError(sourceText("error.provider.codexNotStarted"), "invalid"),
      );
    }

    const outdated = failures.find((failure) => failure.code === "outdated");
    if (outdated) throw outdated;
    if (failures.length > 0) {
      throw new CodexCliError(sourceText("error.provider.codexNotStartedHint"), "invalid");
    }

    throw new CodexCliError(sourceText("error.provider.codexMissing"), "missing");
  },
  Effect.catchDefect((cause) => Effect.fail(providerFailure(cause))),
);

export function bundledCodexExecutable(
  platform = process.platform,
  architecture = process.arch,
  resourcesPath: string | null | undefined = process.resourcesPath,
): string | null {
  return bundledProviderExecutable("codex", platform, architecture, resourcesPath);
}

export const resolveClaudeCli: (input?: {
  systemCandidates?: string[];
  bundledExecutable?: string | null;
}) => Effect.Effect<ClaudeCliInfo, ProviderClientOperationError> = Effect.fn("Cli.resolveClaudeCli")(
  function* (
    input: { systemCandidates?: string[]; bundledExecutable?: string | null } = {},
  ): Effect.fn.Return<ClaudeCliInfo, ProviderClientOperationError> {
    const bundledExecutable =
      input.bundledExecutable === undefined ? bundledClaudeExecutable() : input.bundledExecutable;
    const candidates = yield* cliCandidates("claude", input.systemCandidates, bundledExecutable);
    const failures: CodexCliError[] = [];

    for (const candidate of candidates) {
      if (!(yield* isExecutable(candidate.executable))) continue;

      const attempt = yield* Effect.result(
        Effect.gen(function* () {
          const stdout = yield* readCliVersion(candidate.executable, "claude");
          const version = parseClaudeVersion(stdout);
          if (!isMinimumVersion(version, MINIMUM_CLAUDE_VERSION)) {
            throw new CodexCliError(sourceText("error.provider.claudeOutdated", { version }), "outdated");
          }
          return { executable: candidate.executable, version, source: candidate.source };
        }).pipe(Effect.catchDefect((cause) => Effect.fail(providerFailure(cause)))),
      );
      if (Result.isSuccess(attempt)) return attempt.success;
      const error = attempt.failure.cause;

      if (isCliTimeout(error)) throw error;
      failures.push(
        error instanceof CodexCliError
          ? error
          : new CodexCliError(sourceText("error.provider.claudeNotStarted"), "invalid"),
      );
    }

    const outdated = failures.find((failure) => failure.code === "outdated");
    if (outdated) throw outdated;
    if (failures.length > 0) {
      throw new CodexCliError(sourceText("error.provider.claudeNotStartedHint"), "invalid");
    }

    throw new CodexCliError(sourceText("error.provider.claudeMissing"), "missing");
  },
  Effect.catchDefect((cause) => Effect.fail(providerFailure(cause))),
);

export function bundledClaudeExecutable(
  platform = process.platform,
  architecture = process.arch,
  resourcesPath: string | null | undefined = process.resourcesPath,
): string | null {
  return bundledProviderExecutable("claude", platform, architecture, resourcesPath);
}

export const resolveGrokCli: (input?: {
  systemCandidates?: string[];
  bundledExecutable?: string | null;
}) => Effect.Effect<GrokCliInfo, ProviderClientOperationError> = Effect.fn("Cli.resolveGrokCli")(
  function* (
    input: { systemCandidates?: string[]; bundledExecutable?: string | null } = {},
  ): Effect.fn.Return<GrokCliInfo, ProviderClientOperationError> {
    const bundledExecutable = input.bundledExecutable === undefined ? bundledGrokExecutable() : input.bundledExecutable;
    const candidates = yield* cliCandidates("grok", input.systemCandidates, bundledExecutable);
    const failures: CodexCliError[] = [];

    for (const candidate of candidates) {
      if (!(yield* isExecutable(candidate.executable))) continue;

      const attempt = yield* Effect.result(
        Effect.gen(function* () {
          const stdout = yield* readCliVersion(candidate.executable, "grok");
          const version = parseGrokVersion(stdout);
          if (!isMinimumVersion(version, MINIMUM_GROK_VERSION)) {
            throw new CodexCliError(sourceText("error.provider.grokOutdated", { version }), "outdated");
          }
          return { executable: candidate.executable, version, source: candidate.source };
        }).pipe(Effect.catchDefect((cause) => Effect.fail(providerFailure(cause)))),
      );
      if (Result.isSuccess(attempt)) return attempt.success;
      const error = attempt.failure.cause;

      if (isCliTimeout(error)) throw error;
      failures.push(
        error instanceof CodexCliError
          ? error
          : new CodexCliError(sourceText("error.provider.grokNotStarted"), "invalid"),
      );
    }

    const outdated = failures.find((failure) => failure.code === "outdated");
    if (outdated) throw outdated;
    if (failures.length > 0) {
      throw new CodexCliError(sourceText("error.provider.grokNotStartedHint"), "invalid");
    }

    throw new CodexCliError(sourceText("error.provider.grokMissing"), "missing");
  },
  Effect.catchDefect((cause) => Effect.fail(providerFailure(cause))),
);

/**
 * There is deliberately no minimum version here. OpenBot downloads and pins OpenCode now, but a
 * user who already has the CLI keeps it, and a floor would newly lock out an install that works.
 */
export const resolveOpencodeCli: (input?: {
  systemCandidates?: string[];
  bundledExecutable?: string | null;
}) => Effect.Effect<OpencodeCliInfo, ProviderClientOperationError> = Effect.fn("Cli.resolveOpencodeCli")(
  function* (
    input: { systemCandidates?: string[]; bundledExecutable?: string | null } = {},
  ): Effect.fn.Return<OpencodeCliInfo, ProviderClientOperationError> {
    const bundledExecutable =
      input.bundledExecutable === undefined ? bundledOpencodeExecutable() : input.bundledExecutable;
    const candidates = yield* cliCandidates("opencode", input.systemCandidates, bundledExecutable);
    let found = false;
    for (const candidate of candidates) {
      if (!(yield* isExecutable(candidate.executable))) continue;
      found = true;
      const attempt = yield* Effect.result(
        Effect.gen(function* () {
          const version = parseOpencodeVersion(yield* readCliVersion(candidate.executable, "opencode"));
          // `source` has to be the candidate's own: hardcoding "system" made `updateProviderCli` refuse
          // to activate the managed copy, and made `trackSystemCliVersions` report the managed version
          // as the user's, which suppressed every later update offer.
          return { executable: candidate.executable, version, source: candidate.source };
        }).pipe(Effect.catchDefect((cause) => Effect.fail(providerFailure(cause)))),
      );
      if (Result.isSuccess(attempt)) return attempt.success;
      const error = attempt.failure.cause;

      if (isCliTimeout(error)) throw error;
      /* Try the remaining installed candidates. */
    }
    throw new CodexCliError(
      found ? sourceText("error.provider.opencodeNotStarted") : sourceText("error.provider.opencodeMissing"),
      found ? "invalid" : "missing",
    );
  },
  Effect.catchDefect((cause) => Effect.fail(providerFailure(cause))),
);

/** The file beside `bin/` that names the version of an Antigravity install. */
export const ANTIGRAVITY_MANIFEST = "antigravity-package.json";

export function antigravityHarnessName(target: string): "localharness_external" | "localharness_external.exe" {
  return target.startsWith("win32") ? "localharness_external.exe" : "localharness_external";
}

/**
 * The Antigravity server is never looked for on `PATH`: the Antigravity IDE installs an
 * `antigravity` command that is an editor, not this server. Only the copy OpenBot downloaded, or the
 * path in `OPENBOT_ANTIGRAVITY_PATH`, is used. The server takes no `--version`, so the version comes
 * from the manifest two levels above the program, which a managed install writes.
 *
 * A path the user set is the only candidate: when it cannot start, the error says so, and the
 * managed copy does not run in its place without a message.
 */
export const resolveAntigravityCli: (input?: {
  systemCandidates?: string[];
  bundledExecutable?: string | null;
}) => Effect.Effect<AntigravityCliInfo, ProviderClientOperationError> = Effect.fn("Cli.resolveAntigravityCli")(
  function* (
    input: { systemCandidates?: string[]; bundledExecutable?: string | null } = {},
  ): Effect.fn.Return<AntigravityCliInfo, ProviderClientOperationError> {
    const override = input.systemCandidates ?? [configuredCliPath("antigravity")].filter((path) => path !== null);
    const candidates =
      override.length > 0
        ? override.map((executable) => ({ executable, source: "system" as const }))
        : input.bundledExecutable
          ? [{ executable: input.bundledExecutable, source: "managed" as const }]
          : [];
    let found = false;
    for (const candidate of candidates) {
      if (!(yield* isExecutable(candidate.executable))) continue;
      found = true;
      const attempt = yield* Effect.result(
        Effect.gen(function* () {
          const manifest = join(dirname(dirname(candidate.executable)), ANTIGRAVITY_MANIFEST);
          const version = parseAntigravityVersion(yield* providerCall(() => readFile(manifest, "utf8")));
          return { executable: candidate.executable, version, source: candidate.source };
        }).pipe(Effect.catchDefect((cause) => Effect.fail(providerFailure(cause)))),
      );
      if (Result.isSuccess(attempt)) return attempt.success;

      /* Try the remaining candidates. */
    }
    throw new CodexCliError(
      found ? sourceText("error.provider.antigravityNotStarted") : sourceText("error.provider.antigravityMissing"),
      found ? "invalid" : "missing",
    );
  },
  Effect.catchDefect((cause) => Effect.fail(providerFailure(cause))),
);

export function parseAntigravityVersion(manifest: string): string {
  let version: unknown = null;
  try {
    const value = JSON.parse(manifest);
    if (isDynamicRecord(value)) version = value.version;
  } catch {
    /* Reported below. */
  }
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/u.test(version)) {
    throw new CodexCliError(sourceText("error.provider.antigravityVersionUnreadable"), "invalid");
  }
  return version;
}

/** The file beside `bin/` that names the version of a Cursor install. */
export const CURSOR_MANIFEST = "cursor-package.json";

/**
 * The Cursor CLI is `cursor-agent` on `PATH`. The `cursor` command is the Cursor editor, not this
 * CLI, so it is never used. There is no minimum version, as for OpenCode: a user who already has
 * the CLI keeps it.
 */
export const resolveCursorCli: (input?: {
  systemCandidates?: string[];
  bundledExecutable?: string | null;
}) => Effect.Effect<CursorCliInfo, ProviderClientOperationError> = Effect.fn("Cli.resolveCursorCli")(
  function* (
    input: { systemCandidates?: string[]; bundledExecutable?: string | null } = {},
  ): Effect.fn.Return<CursorCliInfo, ProviderClientOperationError> {
    const candidates = yield* cliCandidates("cursor", input.systemCandidates, input.bundledExecutable ?? null);
    let found = false;
    for (const candidate of candidates) {
      if (!(yield* isExecutable(candidate.executable))) continue;
      found = true;
      const attempt = yield* Effect.result(
        Effect.gen(function* () {
          const version = parseCursorVersion(yield* readCliVersion(candidate.executable, "cursor"));
          return { executable: candidate.executable, version, source: candidate.source };
        }).pipe(Effect.catchDefect((cause) => Effect.fail(providerFailure(cause)))),
      );
      if (Result.isSuccess(attempt)) return attempt.success;
      const error = attempt.failure.cause;

      if (isCliTimeout(error)) throw error;
      /* Try the remaining installed candidates. */
    }
    throw new CodexCliError(
      found ? sourceText("error.provider.cursorNotStarted") : sourceText("error.provider.cursorMissing"),
      found ? "invalid" : "missing",
    );
  },
  Effect.catchDefect((cause) => Effect.fail(providerFailure(cause))),
);

/**
 * Cursor prints its build as a date and a commit, such as `2026.09.28-64d2043`. The newer form that
 * its launcher accepts adds the time: `2026.09.28-10-15-00-64d2043`.
 */
function parseCursorVersion(output: string): string {
  const version = output.trim();
  if (!/^\d{4}\.\d{2}\.\d{2}(?:-\d{2}-\d{2}-\d{2})?-[0-9a-f]{7,40}$/u.test(version)) {
    throw new CodexCliError(sourceText("error.provider.cursorVersionUnreadable"), "invalid");
  }
  return version;
}

/** The version in the manifest that a managed Cursor install writes beside `bin/`. */
export function parseCursorManifestVersion(manifest: string): string {
  let version: unknown = null;
  try {
    const value = JSON.parse(manifest);
    if (isDynamicRecord(value)) version = value.version;
  } catch {
    /* Reported below. */
  }
  if (typeof version !== "string") {
    throw new CodexCliError(sourceText("error.provider.cursorVersionUnreadable"), "invalid");
  }
  return parseCursorVersion(version);
}

/**
 * The Cline CLI is `cline` on `PATH`, which the npm package `cline` installs. A CLI older than
 * `MINIMUM_CLINE_VERSION` is skipped, so a managed one after it is still used. With no newer CLI,
 * the outdated one is the error the user sees.
 */
export const resolveClineCli: (input?: {
  systemCandidates?: string[];
  bundledExecutable?: string | null;
}) => Effect.Effect<ClineCliInfo, ProviderClientOperationError> = Effect.fn("Cli.resolveClineCli")(
  function* (
    input: { systemCandidates?: string[]; bundledExecutable?: string | null } = {},
  ): Effect.fn.Return<ClineCliInfo, ProviderClientOperationError> {
    const candidates = yield* cliCandidates("cline", input.systemCandidates, input.bundledExecutable ?? null);
    const failures: CodexCliError[] = [];
    for (const candidate of candidates) {
      if (!(yield* isExecutable(candidate.executable))) continue;
      const attempt = yield* Effect.result(
        Effect.gen(function* () {
          const version = parseClineVersion(yield* readCliVersion(candidate.executable, "cline"));
          if (!isMinimumVersion(version, MINIMUM_CLINE_VERSION)) {
            throw new CodexCliError(sourceText("error.provider.clineOutdated", { version }), "outdated");
          }
          return { executable: candidate.executable, version, source: candidate.source };
        }).pipe(Effect.catchDefect((cause) => Effect.fail(providerFailure(cause)))),
      );
      if (Result.isSuccess(attempt)) return attempt.success;
      const error = attempt.failure.cause;

      if (isCliTimeout(error)) throw error;
      failures.push(
        error instanceof CodexCliError
          ? error
          : new CodexCliError(sourceText("error.provider.clineNotStarted"), "invalid"),
      );
    }
    throw (
      failures.find((failure) => failure.code === "outdated") ??
      failures[0] ??
      new CodexCliError(sourceText("error.provider.clineMissing"), "missing")
    );
  },
  Effect.catchDefect((cause) => Effect.fail(providerFailure(cause))),
);

export function bundledOpencodeExecutable(
  platform = process.platform,
  architecture = process.arch,
  resourcesPath: string | null | undefined = process.resourcesPath,
): string | null {
  return bundledProviderExecutable("opencode", platform, architecture, resourcesPath);
}

export function bundledGrokExecutable(
  platform = process.platform,
  architecture = process.arch,
  resourcesPath: string | null | undefined = process.resourcesPath,
): string | null {
  return bundledProviderExecutable("grok", platform, architecture, resourcesPath);
}

function bundledProviderExecutable(
  provider: AgentProviderId,
  platform: NodeJS.Platform,
  architecture: string,
  resourcesPath: string | null | undefined,
): string | null {
  const targetPlatform =
    platform === "darwin" && (architecture === "arm64" || architecture === "x64")
      ? "mac"
      : platform === "linux" && (architecture === "x64" || architecture === "arm64")
        ? "linux"
        : platform === "win32" && architecture === "x64"
          ? "win"
          : null;
  if (!targetPlatform) return null;

  const executable = platform === "win32" ? `${provider}.exe` : provider;
  if (!resourcesPath) {
    return resolve("build", provider, targetPlatform, architecture, "bin", executable);
  }

  const targetPath = platform === "win32" ? win32 : posix;
  return targetPath.join(resourcesPath, provider, targetPlatform, architecture, "bin", executable);
}

export function parseCodexVersion(output: string): string {
  const match = output.match(/(?:codex-cli\s+)?(\d+)\.(\d+)\.(\d+)/i);
  if (!match) throw new CodexCliError(sourceText("error.provider.codexVersionUnreadable"), "invalid");
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

export function parseClaudeVersion(output: string): string {
  const match = output.match(/(\d+)\.(\d+)\.(\d+)(?:\s+\(Claude Code\))?/i);
  if (!match) throw new CodexCliError(sourceText("error.provider.claudeVersionUnreadable"), "invalid");
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

export function parseGrokVersion(output: string): string {
  const match = output.match(/(?:grok(?:-cli)?\s+)?v?(\d+)\.(\d+)\.(\d+)/i);
  if (!match) throw new CodexCliError(sourceText("error.provider.grokVersionUnreadable"), "invalid");
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

/** OpenCode prints a bare `1.18.30`, and `verifyInstalledRuntime` compares that exactly. */
export function parseOpencodeVersion(output: string): string {
  const match = output.trim().match(/^(?:opencode\s+)?v?(\d+)\.(\d+)\.(\d+)(?:[-+][\w.-]+)?$/i);
  if (!match) throw new CodexCliError(sourceText("error.provider.opencodeVersionUnreadable"), "invalid");
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

/** Cline prints a bare `3.0.68`, the npm version of its package. */
export function parseClineVersion(output: string): string {
  const match = output.trim().match(/^(?:cline\s+)?v?(\d+)\.(\d+)\.(\d+)(?:[-+][\w.-]+)?$/i);
  if (!match) throw new CodexCliError(sourceText("error.provider.clineVersionUnreadable"), "invalid");
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

/**
 * Bun prints a bare `1.4.2` and nothing else. It is not a provider CLI, so no discovery step reads
 * this; only `verifyInstalledRuntime` does, to confirm the binary in the store is the pinned one.
 */
export function parseBunVersion(output: string): string {
  const match = output.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+][\w.-]+)?$/);
  if (!match) throw new CodexCliError(sourceText("error.provider.bunVersionUnreadable"), "invalid");
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

/**
 * Whether this Claude Code takes `--system-prompt-snapshot`. Checked in 2.1.263, the version the
 * lock falls back to; an older CLI above the minimum would reject the unknown flag and not start.
 */
export function claudeTakesPromptSnapshotFlag(version: string): boolean {
  return isMinimumVersion(version, [2, 1, 263]);
}

function isMinimumVersion(version: string, minimum: readonly number[]): boolean {
  const parts = version.split(".").map(Number);
  for (const [index, required] of minimum.entries()) {
    // A missing part compares like NaN: neither above nor below the minimum.
    const part = parts[index] ?? Number.NaN;
    if (part > required) return true;
    if (part < required) return false;
  }
  return true;
}

/** The command name of a provider's CLI on `PATH`. */
function cliCommandName(provider: AgentProviderId): string {
  return provider === "cursor" ? "cursor-agent" : provider;
}

/** An explicit path remains under the user's control, including during managed updates. */
export function configuredCliPath(provider: AgentProviderId): string | null {
  return process.env[`OPENBOT_${provider.toUpperCase()}_PATH`]?.trim() || null;
}

const cliCandidates = Effect.fn("Cli.candidates")(function* (
  provider: AgentProviderId,
  systemCandidates: string[] | undefined,
  bundledExecutable: string | null,
) {
  const override = systemCandidates === undefined ? configuredCliPath(provider) : null;
  const system = (systemCandidates ?? (yield* collectCandidates(provider, override ?? undefined))).map(
    (executable) => ({
      executable,
      source: "system" as const,
    }),
  );
  const managed = bundledExecutable ? [{ executable: bundledExecutable, source: "managed" as const }] : [];
  return (override ? [...system, ...managed] : [...managed, ...system]).filter(
    (candidate, index, all) => all.findIndex((other) => other.executable === candidate.executable) === index,
  );
});

/**
 * `command` goes into a login shell as `command -v <command>`, so it takes a fixed provider id and
 * nothing else. A command the user typed, as for a custom agent, is resolved by
 * `resolveAgentCommand` in `acp-agent-command.ts`, which never gives it to a shell.
 */
const collectCandidates = Effect.fn("Cli.collectCandidates")(function* (
  provider: AgentProviderId,
  configuredPath: string | undefined,
) {
  const candidates: string[] = [];
  const override = configuredPath?.trim();
  if (override) return [override];
  const command = cliCommandName(provider);
  if (process.platform === "win32") {
    const output = yield* providerCall(() =>
      execFileAsync("where.exe", [command], { timeout: 5_000, maxBuffer: 64 * 1024 }),
    ).pipe(Effect.catch(() => Effect.succeed({ stdout: "" })));
    candidates.push(
      ...output.stdout
        .split(/\r?\n/u)
        .map((path) => path.trim())
        .filter(Boolean),
    );
    candidates.push(...windowsFallbackPaths(provider));
  } else {
    const output = yield* runInLoginShell(`command -v ${command}`).pipe(Effect.catch(() => Effect.succeed("")));
    const path = commandPathFromShellOutput(output);
    if (path) candidates.push(path);
    candidates.push(...posixFallbackPaths(provider));
  }
  return [...new Set(candidates)];
});

export function windowsFallbackPaths(
  provider: AgentProviderId,
  userHome = homedir(),
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  const command = cliCommandName(provider);
  const paths: string[] = [];
  const appData = environment.APPDATA?.trim();
  const localAppData = environment.LOCALAPPDATA?.trim();

  if (command === "codex" && localAppData) {
    paths.push(win32.join(localAppData, "Programs", "OpenAI", "Codex", "bin", "codex.exe"));
  }
  if (command === "claude" && localAppData) {
    paths.push(win32.join(localAppData, "Microsoft", "WinGet", "Links", "claude.exe"));
  }
  // Cursor's installer puts the launcher in a folder of its own and adds that folder to `PATH`.
  if (command === "cursor-agent" && localAppData) {
    paths.push(win32.join(localAppData, "cursor-agent", "cursor-agent.cmd"));
  }
  if (command === "grok") {
    paths.push(win32.join(userHome, ".grok", "bin", "grok.exe"));
    if (localAppData) paths.push(win32.join(localAppData, "Microsoft", "WinGet", "Links", "grok.exe"));
  }
  if (appData) paths.push(win32.join(appData, "npm", `${command}.cmd`));
  paths.push(
    win32.join(userHome, ".local", "bin", `${command}.exe`),
    win32.join(userHome, ".bun", "bin", `${command}.exe`),
    win32.join(userHome, ".bun", "bin", `${command}.cmd`),
  );
  if (localAppData) {
    paths.push(win32.join(localAppData, "pnpm", `${command}.exe`), win32.join(localAppData, "pnpm", `${command}.cmd`));
  }

  return paths;
}

/**
 * The shell that answers `command -v`. It has to be a login shell, because that is what reads the
 * profile a version manager appends its `PATH` to, and a packaged app inherits none of it.
 *
 * macOS keeps `/bin/zsh`: it is the default login shell and is always present. Linux cannot assume
 * zsh is installed at all, so it prefers the user's own `$SHELL` and falls back to `/bin/sh`. The
 * `-i` flag goes with it, because `sh` is not required to accept an interactive non-tty invocation
 * and dash exits rather than running the command.
 */
export function loginShellCommand(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): { command: string; args: string[] } {
  if (platform !== "linux") return { command: "/bin/zsh", args: ["-lic"] };
  const preferred = environment.SHELL?.trim();
  if (!preferred) return { command: "/bin/sh", args: ["-lc"] };
  return { command: preferred, args: preferred.endsWith("/sh") ? ["-lc"] : ["-lic"] };
}

/**
 * The path that `command -v` printed, from what the login shell wrote. An interactive profile can
 * print before the command runs, such as a greeting or `fastfetch`, so the path is the last line
 * that is an absolute path. An alias, a function or a builtin prints no path and gives `null`.
 */
export function commandPathFromShellOutput(stdout: string): string | null {
  const lines = stdout.split(/\r?\n/u).map((line) => line.trim());
  return lines.findLast((line) => line.startsWith("/")) ?? null;
}

const LOGIN_SHELL_TIMEOUT_MS = 5_000;
const LOGIN_SHELL_MAX_OUTPUT_BYTES = 64 * 1024;

/**
 * Runs one script in the user's login shell and returns what it printed.
 *
 * The shell starts in a session of its own, with no controlling terminal. An interactive bash that
 * finds the terminal held by another process group sends SIGTTIN to its own group, and without a
 * session of its own that group is OpenBot's. An OpenBot started from a terminal then stopped as soon
 * as two lookups overlapped, and only SIGKILL could end it (#766). With no terminal, the shell turns
 * job control off instead. `execFile` cannot do this: it does not pass `detached` on to `spawn`.
 *
 * A failed start, a non-zero exit, a signal, the timeout and too much output all reject, as
 * `execFile` did, so each caller keeps its fallback.
 */
export function runInLoginShell(
  script: string,
  shell = loginShellCommand(),
): Effect.Effect<string, ProviderClientOperationError> {
  return Effect.callback<string, ProviderClientOperationError>((resume) => {
    const resolve = (value: string) => resume(Effect.succeed(value));
    const reject = (cause: unknown) => resume(Effect.fail(providerFailure(cause)));
    let finished = false;
    const child = spawn(shell.command, [...shell.args, script], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let failure: Error | null = null;
    // The whole group, so that nothing the user's profile started outlives the lookup. The pipes are
    // closed too, as `execFile` did: a process outside the group can still hold them, and `close`
    // waits for every holder.
    const stop = (error: Error) => {
      if (failure) return;
      failure = error;
      child.stdout.destroy();
      child.stderr.destroy();
      try {
        if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      } catch {
        // The group has already exited.
      }
    };
    const timer = setTimeout(
      () => stop(new Error(`The login shell did not finish in ${LOGIN_SHELL_TIMEOUT_MS / 1000} seconds.`)),
      LOGIN_SHELL_TIMEOUT_MS,
    );
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > LOGIN_SHELL_MAX_OUTPUT_BYTES) stop(new Error("The login shell printed too much output."));
      else chunks.push(chunk);
    });
    // Drained and dropped: an interactive shell with no terminal reports that job control is off.
    child.stderr.resume();
    child.once("error", (error) => {
      finished = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      finished = true;
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`The login shell exited with ${signal ?? `code ${code}`}.`));
      else resolve(Buffer.concat(chunks).toString("utf8"));
    });
    return Effect.sync(() => {
      clearTimeout(timer);
      if (!finished) stop(new Error("Login shell interrupted."));
    });
  });
}

export function posixFallbackPaths(provider: AgentProviderId, userHome = homedir()): string[] {
  const command = cliCommandName(provider);
  const paths = [posix.join(userHome, ".local", "bin", command)];
  if (command === "claude") paths.push(posix.join(userHome, ".claude", "local", "claude"));
  if (command === "opencode") paths.push(posix.join(userHome, ".opencode", "bin", "opencode"));
  if (command === "grok") paths.push(posix.join(userHome, ".grok", "bin", "grok"));
  paths.push(`/opt/homebrew/bin/${command}`, `/usr/local/bin/${command}`, `/usr/bin/${command}`);
  return paths;
}

/**
 * One argument on a `cmd.exe /c` line that runs a batch wrapper. `cmd.exe` reads the line first: it
 * toggles quoting at every `"` and expands `%NAME%` inside quotes too. The wrapper then hands `%*` to
 * a program that splits it with the C runtime rules. So an argument with any character outside a
 * plain set is quoted, an inner `"` is written as `""` with the backslashes before it doubled, which
 * both parsers read as one literal quote, and `%` is written as `%%cd:~,%`, which expands to one `%`.
 */
function batchArgument(argument: string): string {
  if (/^[\w\-.,/:=@+\\]+$/.test(argument)) return argument;
  let quoted = '"';
  let backslashes = 0;
  for (const character of argument) {
    if (character === "\\") {
      backslashes += 1;
    } else {
      if (character === '"') quoted += `${"\\".repeat(backslashes)}"`;
      backslashes = 0;
    }
    quoted += character === "%" ? "%%cd:~,%" : character;
  }
  return `${quoted}${"\\".repeat(backslashes)}"`;
}

/**
 * How to start a resolved CLI. A `.cmd` or `.bat` wrapper is a script that only the Windows command
 * processor runs, so it is called through `cmd.exe` with the same verbatim quoting as
 * `readCliVersion`. Every other executable starts with no shell. That keeps a path that holds a
 * space runnable: a managed CLI lives under `userData`, which holds a space for a user such as
 * `C:\Users\Jane Doe` and for the `OpenBot Dev` profile, and `cmd.exe` would split it there.
 */
export function cliSpawnTarget(
  executable: string,
  argv: readonly string[],
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[]; windowsVerbatimArguments: boolean } {
  if (platform !== "win32" || ![".bat", ".cmd"].includes(extname(executable).toLowerCase())) {
    return { command: executable, args: [...argv], windowsVerbatimArguments: false };
  }

  const commandLine = [`"${executable.replaceAll("%", "%%")}"`, ...argv.map(batchArgument)].join(" ");
  return {
    command: process.env.ComSpec?.trim() || "cmd.exe",
    args: ["/d", "/s", "/c", `"${commandLine}"`],
    windowsVerbatimArguments: true,
  };
}

/**
 * A busy computer can take many seconds to start a CLI, so the limit is generous. A timeout is
 * reported apart from a failure: the CLI is not broken, and reinstalling it does not help. The
 * provider runtime tries again later, so this limit only has to cover one slow answer.
 */
const CLI_VERSION_TIMEOUT_MS = 10_000;

/**
 * A busy computer makes every candidate slow, so the resolvers report the first timeout and do not
 * wait for the next candidate. It also wins over a candidate that answered as outdated.
 */
function isCliTimeout(error: unknown): error is CodexCliError {
  return error instanceof CodexCliError && error.code === "timeout";
}

const readCliVersion = Effect.fn("Cli.readVersion")(function* (candidate: string, provider: AgentProviderId) {
  const target = process.platform === "win32" && [".bat", ".cmd"].includes(extname(candidate).toLowerCase());
  const output = yield* providerCall(() =>
    target
      ? execFileAsync(
          process.env.ComSpec?.trim() || "cmd.exe",
          ["/d", "/s", "/c", `""${candidate.replaceAll("%", "%%")}" --version"`],
          {
            timeout: CLI_VERSION_TIMEOUT_MS,
            maxBuffer: 64 * 1024,
            windowsHide: true,
            windowsVerbatimArguments: true,
          },
        )
      : execFileAsync(candidate, ["--version"], {
          timeout: CLI_VERSION_TIMEOUT_MS,
          maxBuffer: 64 * 1024,
          windowsHide: process.platform === "win32",
        }),
  ).pipe(
    Effect.mapError((failure) =>
      isDynamicRecord(failure.cause) && failure.cause.killed === true
        ? providerFailure(
            new CodexCliError(
              sourceText("error.provider.cliTimedOutRefresh", { provider: agentProviderName(provider) }),
              "timeout",
            ),
          )
        : failure,
    ),
  );
  return output.stdout;
});

const isExecutable = Effect.fn("Cli.isExecutable")((path: string) =>
  providerCall(() => access(path, process.platform === "win32" ? constants.F_OK : constants.X_OK)).pipe(
    Effect.match({ onSuccess: () => true, onFailure: () => false }),
  ),
);
