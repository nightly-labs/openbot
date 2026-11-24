import { execFile, spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, open, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, dirname, extname, isAbsolute, join, posix, resolve, win32 } from "node:path";
import { promisify, stripVTControlCharacters } from "node:util";
import { olderVersion } from "@openbot/contracts/cli-version";
import { type AgentProviderId, agentProviderName } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect, Result } from "effect";
import { providerCheckTimeoutMs } from "./disk-restore";
import type { SignInRegion } from "./kimi-region";
import { type ProviderClientOperationError, providerCall, providerFailure } from "./provider-client-effects";

export { compareReleases, isVersion, olderVersion } from "@openbot/contracts/cli-version";

const execFileAsync = promisify(execFile);
const MINIMUM_CODEX_VERSION = [0, 156, 0] as const;
const MINIMUM_CLAUDE_VERSION = [2, 1, 232] as const;
const MINIMUM_GROK_VERSION = [1, 0, 5] as const;
const MINIMUM_CLINE_VERSION = [3, 0, 68] as const;
const MINIMUM_KIMI_VERSION = [1, 52, 0] as const;

interface ResolvedCli {
  executable: string;
  version: string;
  launchPath?: string;
  incomplete?: true;
}

export interface CodexCliInfo extends ResolvedCli {
  source: "system" | "managed";
}

export interface ClaudeCliInfo extends ResolvedCli {
  source?: "system" | "managed";
}

export interface GrokCliInfo extends ResolvedCli {
  source?: "system" | "managed";
}

export interface OpencodeCliInfo extends ResolvedCli {
  source?: "system" | "managed";
}

export interface AntigravityCliInfo extends ResolvedCli {
  source?: "system" | "managed";
}

export interface CursorCliInfo extends ResolvedCli {
  source?: "system" | "managed";
}

export interface ClineCliInfo extends ResolvedCli {
  source?: "system" | "managed";
}

export interface KimiCliInfo extends ResolvedCli {
  source?: "system" | "managed";
}

export interface HermesCliInfo extends ResolvedCli {
  source?: "system" | "managed";
}

export type AgentCliInfo =
  | CodexCliInfo
  | ClaudeCliInfo
  | GrokCliInfo
  | OpencodeCliInfo
  | AntigravityCliInfo
  | CursorCliInfo
  | ClineCliInfo
  | KimiCliInfo
  | HermesCliInfo;

export class CodexCliError extends Error {
  constructor(
    message: string,
    readonly code: "missing" | "invalid" | "outdated" | "timeout",
  ) {
    super(message);
    this.name = "CodexCliError";
  }
}

export type BundledProviderExecutables = Partial<Record<AgentProviderId, string | null | undefined>>;

export const resolveCodexCli: (input?: {
  systemCandidates?: string[];
  bundledExecutable?: string | null | undefined;
}) => Effect.Effect<CodexCliInfo, ProviderClientOperationError> = Effect.fn("Cli.resolveCodexCli")(
  function* (
    input: { systemCandidates?: string[]; bundledExecutable?: string | null | undefined } = {},
  ): Effect.fn.Return<CodexCliInfo, ProviderClientOperationError> {
    const bundledExecutable =
      input.bundledExecutable === undefined ? bundledCodexExecutable() : input.bundledExecutable;
    const candidates = yield* cliCandidates("codex", input.systemCandidates, bundledExecutable);
    const failures: CodexCliError[] = [];
    let firstFailedSource: "system" | "managed" | undefined;
    const configured = input.systemCandidates === undefined ? configuredCliPath("codex") : null;
    let incomplete: CodexCliInfo | undefined;

    for (const candidate of candidates) {
      if (!(yield* isExecutable(candidate.executable))) continue;

      const attempt = yield* Effect.result(
        Effect.gen(function* () {
          const { stdout, launch } = yield* readCliVersion(candidate, "codex");
          const version = parseCodexVersion(stdout);
          if (!isMinimumVersion(version, MINIMUM_CODEX_VERSION)) {
            throw new CodexCliError(sourceText("error.provider.codexOutdated", { version }), "outdated");
          }

          return { executable: candidate.executable, version, source: candidate.source, ...launch };
        }).pipe(Effect.catchDefect((cause) => Effect.fail(providerFailure(cause)))),
      );
      if (Result.isSuccess(attempt)) {
        const cli = attempt.success;
        if (cli.source === "managed" || cli.executable === configured || (yield* hasCodeModeHost(cli.executable))) {
          return cli;
        }
        incomplete ??= { ...cli, incomplete: true };
        continue;
      }
      const error = attempt.failure.cause;

      if (isCliTimeout(error)) {
        if (incomplete) return incomplete;
        throw error;
      }
      firstFailedSource ??= candidate.source;
      failures.push(
        error instanceof CodexCliError
          ? error
          : new CodexCliError(sourceText("error.provider.codexNotStarted"), "invalid"),
      );
    }

    if (incomplete) return incomplete;
    const outdated = failures.find((failure) => failure.code === "outdated");
    if (outdated) throw outdated;
    if (failures.length > 0) {
      throw new CodexCliError(
        sourceText(
          firstFailedSource === "managed"
            ? "error.provider.codexManagedNotStarted"
            : "error.provider.codexNotStartedHint",
        ),
        "invalid",
      );
    }

    throw new CodexCliError(sourceText("error.provider.codexMissing"), "missing");
  },
  Effect.catchDefect((cause) => Effect.fail(providerFailure(cause))),
);

function bundledCodexExecutable(
  platform = process.platform,
  architecture = process.arch,
  resourcesPath: string | null | undefined = process.resourcesPath,
): string | null {
  return bundledProviderExecutable("codex", platform, architecture, resourcesPath);
}

const CODEX_LAUNCHER = /^(?:volta-shim|mise|aqua-proxy)(?:\.exe)?$/iu;

const hasCodeModeHost = Effect.fn("Cli.hasCodeModeHost")((executable: string) =>
  providerCall(async () => {
    const program = await realpath(executable);
    if (CODEX_LAUNCHER.test(basename(program))) return true;
    const isFile = (path: string) =>
      stat(path).then(
        (info) => info.isFile(),
        () => false,
      );
    if (process.platform === "win32") {
      if (extname(program).toLowerCase() !== ".exe") return true;
      const stem = program.slice(0, -".exe".length);
      if ((await isFile(`${stem}.bunx`)) || (await isFile(`${stem}.shim`))) return true;
    } else {
      const file = await open(program, "r");
      try {
        const { buffer, bytesRead } = await file.read(Buffer.alloc(2), 0, 2, 0);
        if (bytesRead === 2 && buffer.toString("latin1") === "#!") return true;
      } finally {
        await file.close();
      }
    }
    const host = process.platform === "win32" ? "codex-code-mode-host.exe" : "codex-code-mode-host";
    const folder = dirname(program);
    return (await isFile(join(folder, host))) || (await isFile(join(folder, "..", "codex-resources", host)));
  }).pipe(Effect.orElseSucceed(() => true)),
);

export const resolveClaudeCli: (input?: {
  systemCandidates?: string[];
  bundledExecutable?: string | null | undefined;
}) => Effect.Effect<ClaudeCliInfo, ProviderClientOperationError> = Effect.fn("Cli.resolveClaudeCli")(
  function* (
    input: { systemCandidates?: string[]; bundledExecutable?: string | null | undefined } = {},
  ): Effect.fn.Return<ClaudeCliInfo, ProviderClientOperationError> {
    const bundledExecutable =
      input.bundledExecutable === undefined ? bundledClaudeExecutable() : input.bundledExecutable;
    const candidates = yield* cliCandidates("claude", input.systemCandidates, bundledExecutable);
    const failures: CodexCliError[] = [];
    let firstFailedSource: "system" | "managed" | undefined;

    for (const candidate of candidates) {
      if (!(yield* isExecutable(candidate.executable))) continue;

      const attempt = yield* Effect.result(
        Effect.gen(function* () {
          const { stdout, launch } = yield* readCliVersion(candidate, "claude");
          const version = parseClaudeVersion(stdout);
          if (!isMinimumVersion(version, MINIMUM_CLAUDE_VERSION)) {
            throw new CodexCliError(sourceText("error.provider.claudeOutdated", { version }), "outdated");
          }
          return { executable: candidate.executable, version, source: candidate.source, ...launch };
        }).pipe(Effect.catchDefect((cause) => Effect.fail(providerFailure(cause)))),
      );
      if (Result.isSuccess(attempt)) return attempt.success;
      const error = attempt.failure.cause;

      if (isCliTimeout(error)) throw error;
      firstFailedSource ??= candidate.source;
      failures.push(
        error instanceof CodexCliError
          ? error
          : new CodexCliError(sourceText("error.provider.claudeNotStarted"), "invalid"),
      );
    }

    const outdated = failures.find((failure) => failure.code === "outdated");
    if (outdated) throw outdated;
    if (failures.length > 0) {
      throw new CodexCliError(
        sourceText(
          firstFailedSource === "managed"
            ? "error.provider.claudeManagedNotStarted"
            : "error.provider.claudeNotStartedHint",
        ),
        "invalid",
      );
    }

    throw new CodexCliError(sourceText("error.provider.claudeMissing"), "missing");
  },
  Effect.catchDefect((cause) => Effect.fail(providerFailure(cause))),
);

function bundledClaudeExecutable(
  platform = process.platform,
  architecture = process.arch,
  resourcesPath: string | null | undefined = process.resourcesPath,
): string | null {
  return bundledProviderExecutable("claude", platform, architecture, resourcesPath);
}

export const resolveGrokCli: (input?: {
  systemCandidates?: string[];
  bundledExecutable?: string | null | undefined;
}) => Effect.Effect<GrokCliInfo, ProviderClientOperationError> = Effect.fn("Cli.resolveGrokCli")(
  function* (
    input: { systemCandidates?: string[]; bundledExecutable?: string | null | undefined } = {},
  ): Effect.fn.Return<GrokCliInfo, ProviderClientOperationError> {
    const bundledExecutable = input.bundledExecutable === undefined ? bundledGrokExecutable() : input.bundledExecutable;
    const candidates = yield* cliCandidates("grok", input.systemCandidates, bundledExecutable);
    const failures: CodexCliError[] = [];

    for (const candidate of candidates) {
      if (!(yield* isExecutable(candidate.executable))) continue;

      const attempt = yield* Effect.result(
        Effect.gen(function* () {
          const { stdout, launch } = yield* readCliVersion(candidate, "grok");
          const version = parseGrokVersion(stdout);
          if (!isMinimumVersion(version, MINIMUM_GROK_VERSION)) {
            throw new CodexCliError(sourceText("error.provider.grokOutdated", { version }), "outdated");
          }
          return { executable: candidate.executable, version, source: candidate.source, ...launch };
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

export const resolveOpencodeCli: (input?: {
  systemCandidates?: string[];
  bundledExecutable?: string | null | undefined;
}) => Effect.Effect<OpencodeCliInfo, ProviderClientOperationError> = Effect.fn("Cli.resolveOpencodeCli")(
  function* (
    input: { systemCandidates?: string[]; bundledExecutable?: string | null | undefined } = {},
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
          const { stdout, launch } = yield* readCliVersion(candidate, "opencode");
          const version = parseOpencodeVersion(stdout);
          return { executable: candidate.executable, version, source: candidate.source, ...launch };
        }).pipe(Effect.catchDefect((cause) => Effect.fail(providerFailure(cause)))),
      );
      if (Result.isSuccess(attempt)) return attempt.success;
      const error = attempt.failure.cause;

      if (isCliTimeout(error)) throw error;
    }
    throw new CodexCliError(
      found ? sourceText("error.provider.opencodeNotStarted") : sourceText("error.provider.opencodeMissing"),
      found ? "invalid" : "missing",
    );
  },
  Effect.catchDefect((cause) => Effect.fail(providerFailure(cause))),
);

export const resolveAntigravityCli: (input?: {
  systemCandidates?: string[];
  bundledExecutable?: string | null | undefined;
}) => Effect.Effect<AntigravityCliInfo, ProviderClientOperationError> = Effect.fn("Cli.resolveAntigravityCli")(
  function* (
    input: { systemCandidates?: string[]; bundledExecutable?: string | null | undefined } = {},
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
          const { stdout, launch } = yield* readCliVersion(candidate, "antigravity");
          return {
            executable: candidate.executable,
            version: parseAntigravityVersion(stdout),
            source: candidate.source,
            ...launch,
          };
        }).pipe(Effect.catchDefect((cause) => Effect.fail(providerFailure(cause)))),
      );
      if (Result.isSuccess(attempt)) return attempt.success;
      if (isCliTimeout(attempt.failure.cause)) return yield* Effect.fail(attempt.failure);
    }
    if (!found && override.length > 0)
      throw new CodexCliError(sourceText("error.provider.antigravityOverrideInvalid"), "invalid");
    throw new CodexCliError(
      found ? sourceText("error.provider.antigravityNotStarted") : sourceText("error.provider.antigravityMissing"),
      found ? "invalid" : "missing",
    );
  },
  Effect.catchDefect((cause) => Effect.fail(providerFailure(cause))),
);

function parseAntigravityVersion(output: string): string {
  const version = /^\s*(\d+\.\d+\.\d+)\s*$/u.exec(output)?.[1];
  if (!version) throw new CodexCliError(sourceText("error.provider.antigravityVersionUnreadable"), "invalid");
  return version;
}

export const CURSOR_MANIFEST = "cursor-package.json";

export const resolveCursorCli: (input?: {
  systemCandidates?: string[];
  bundledExecutable?: string | null | undefined;
}) => Effect.Effect<CursorCliInfo, ProviderClientOperationError> = Effect.fn("Cli.resolveCursorCli")(
  function* (
    input: { systemCandidates?: string[]; bundledExecutable?: string | null | undefined } = {},
  ): Effect.fn.Return<CursorCliInfo, ProviderClientOperationError> {
    const candidates = yield* cliCandidates("cursor", input.systemCandidates, input.bundledExecutable ?? null);
    let found = false;
    for (const candidate of candidates) {
      if (!(yield* isExecutable(candidate.executable))) continue;
      found = true;
      const attempt = yield* Effect.result(
        Effect.gen(function* () {
          const { stdout, launch } = yield* readCliVersion(candidate, "cursor");
          const version = parseCursorVersion(stdout);
          return { executable: candidate.executable, version, source: candidate.source, ...launch };
        }).pipe(Effect.catchDefect((cause) => Effect.fail(providerFailure(cause)))),
      );
      if (Result.isSuccess(attempt)) return attempt.success;
      const error = attempt.failure.cause;

      if (isCliTimeout(error)) throw error;
    }
    throw new CodexCliError(
      found ? sourceText("error.provider.cursorNotStarted") : sourceText("error.provider.cursorMissing"),
      found ? "invalid" : "missing",
    );
  },
  Effect.catchDefect((cause) => Effect.fail(providerFailure(cause))),
);

export const resolveHermesCli: (input?: {
  systemCandidates?: string[];
}) => Effect.Effect<HermesCliInfo, ProviderClientOperationError> = Effect.fn("Cli.resolveHermesCli")(
  function* (
    input: { systemCandidates?: string[] } = {},
  ): Effect.fn.Return<HermesCliInfo, ProviderClientOperationError> {
    const candidates = yield* cliCandidates("hermes", input.systemCandidates, null);
    let found = false;
    for (const candidate of candidates) {
      if (!(yield* isExecutable(candidate.executable))) continue;
      found = true;
      const read = (args: readonly string[]) =>
        Effect.gen(function* () {
          const { stdout, launch } = yield* readCliVersion(candidate, "hermes", args);
          return {
            executable: candidate.executable,
            version: parseHermesVersion(stdout),
            source: "system" as const,
            ...launch,
          };
        }).pipe(Effect.catchDefect((cause) => Effect.fail(providerFailure(cause))));
      const quick = yield* Effect.result(read(["acp", "--version"]));
      const attempt =
        Result.isSuccess(quick) || isCliTimeout(quick.failure.cause)
          ? quick
          : yield* Effect.result(read(["--version"]));
      if (Result.isSuccess(attempt)) return attempt.success;
      const error = attempt.failure.cause;

      if (isCliTimeout(error)) throw error;
    }
    throw new CodexCliError(
      found ? sourceText("error.provider.hermesNotStarted") : sourceText("error.provider.hermesMissing"),
      found ? "invalid" : "missing",
    );
  },
  Effect.catchDefect((cause) => Effect.fail(providerFailure(cause))),
);

function parseHermesVersion(output: string): string {
  const version = output.match(/^(?:Hermes Agent v)?(\d+\.\d+\.\d+)\b/mu)?.[1];
  if (!version) throw new CodexCliError(sourceText("error.provider.hermesVersionUnreadable"), "invalid");
  return version;
}

function parseCursorVersion(output: string): string {
  const version = output.trim();
  if (!/^\d{4}\.\d{2}\.\d{2}(?:-\d{2}-\d{2}-\d{2})?-[0-9a-f]{7,40}$/u.test(version)) {
    throw new CodexCliError(sourceText("error.provider.cursorVersionUnreadable"), "invalid");
  }
  return version;
}

export function parseCursorManifestVersion(manifest: string): string {
  let version: unknown = null;
  try {
    const value = JSON.parse(manifest);
    if (isDynamicRecord(value)) version = value.version;
  } catch {}
  if (typeof version !== "string") {
    throw new CodexCliError(sourceText("error.provider.cursorVersionUnreadable"), "invalid");
  }
  return parseCursorVersion(version);
}

export const resolveClineCli: (input?: {
  systemCandidates?: string[];
  bundledExecutable?: string | null | undefined;
}) => Effect.Effect<ClineCliInfo, ProviderClientOperationError> = Effect.fn("Cli.resolveClineCli")(
  function* (
    input: { systemCandidates?: string[]; bundledExecutable?: string | null | undefined } = {},
  ): Effect.fn.Return<ClineCliInfo, ProviderClientOperationError> {
    const candidates = yield* cliCandidates("cline", input.systemCandidates, input.bundledExecutable ?? null);
    const failures: CodexCliError[] = [];
    for (const candidate of candidates) {
      if (!(yield* isExecutable(candidate.executable))) continue;
      const attempt = yield* Effect.result(
        Effect.gen(function* () {
          const { stdout, launch } = yield* readCliVersion(candidate, "cline");
          const version = parseClineVersion(stdout);
          if (!isMinimumVersion(version, MINIMUM_CLINE_VERSION)) {
            throw new CodexCliError(sourceText("error.provider.clineOutdated", { version }), "outdated");
          }
          return { executable: candidate.executable, version, source: candidate.source, ...launch };
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

export const resolveKimiCli: (input?: {
  systemCandidates?: string[];
  bundledExecutable?: string | null | undefined;
}) => Effect.Effect<KimiCliInfo, ProviderClientOperationError> = Effect.fn("Cli.resolveKimiCli")(
  function* (
    input: { systemCandidates?: string[]; bundledExecutable?: string | null | undefined } = {},
  ): Effect.fn.Return<KimiCliInfo, ProviderClientOperationError> {
    const candidates = yield* cliCandidates("kimi", input.systemCandidates, input.bundledExecutable ?? null);
    const failures: CodexCliError[] = [];
    for (const candidate of candidates) {
      if (!(yield* isExecutable(candidate.executable))) continue;
      const attempt = yield* Effect.result(
        Effect.gen(function* () {
          const { stdout, launch } = yield* readCliVersion(candidate, "kimi");
          const version = parseKimiVersion(stdout);
          if (!isMinimumVersion(version, MINIMUM_KIMI_VERSION)) {
            throw new CodexCliError(sourceText("error.provider.kimiOutdated", { version }), "outdated");
          }
          return { executable: candidate.executable, version, source: candidate.source, ...launch };
        }).pipe(Effect.catchDefect((cause) => Effect.fail(providerFailure(cause)))),
      );
      if (Result.isSuccess(attempt)) return attempt.success;
      const error = attempt.failure.cause;

      if (isCliTimeout(error)) throw error;
      failures.push(
        error instanceof CodexCliError
          ? error
          : new CodexCliError(sourceText("error.provider.kimiNotStarted"), "invalid"),
      );
    }
    throw (
      failures.find((failure) => failure.code === "outdated") ??
      failures[0] ??
      new CodexCliError(sourceText("error.provider.kimiMissing"), "missing")
    );
  },
  Effect.catchDefect((cause) => Effect.fail(providerFailure(cause))),
);

export const kimiLoginArgs = Effect.fn("Cli.kimiLoginArgs")(function* (
  cli: { executable: string; launchPath?: string },
  env: Readonly<Record<string, string>>,
  options: { code: boolean; region: SignInRegion },
): Effect.fn.Return<readonly string[], ProviderClientOperationError> {
  const target = cliSpawnTarget(cli.executable, ["login", "--help"]);
  const probe = Effect.tryPromise({
    try: (signal) =>
      execFileAsync(target.command, target.args, {
        signal,
        timeout: CLI_VERSION_TIMEOUT_MS,
        maxBuffer: 64 * 1024,
        windowsHide: process.platform === "win32",
        windowsVerbatimArguments: target.windowsVerbatimArguments,
        env: { ...process.env, ...cliPathEnvironment(cli), ...env },
      }),
    catch: (cause) => {
      const timedOut = isDynamicRecord(cause) && cause.killed === true;
      return providerFailure(
        new CodexCliError(
          timedOut
            ? sourceText("error.provider.cliTimedOutRefresh", { provider: agentProviderName("kimi") })
            : sourceText("error.provider.noCodeSignIn", { provider: agentProviderName("kimi") }),
          timedOut ? "timeout" : "invalid",
        ),
      );
    },
  });
  const output = options.code ? yield* probe : yield* Effect.orElseSucceed(probe, () => ({ stdout: "", stderr: "" }));
  const help = stripVTControlCharacters(`${output.stdout}\n${output.stderr}`);
  if (/\bkimi\b/i.test(help)) {
    if (/--json(?:\s|[,=]|$)/u.test(help)) return options.code ? ["login", "--json"] : ["login"];
    if (/--region\b/u.test(help) && /device-code/u.test(help)) return ["login", "--region", options.region];
  }
  if (!options.code) return ["login"];
  return yield* providerFailure(
    new CodexCliError(sourceText("error.provider.noCodeSignIn", { provider: agentProviderName("kimi") }), "invalid"),
  );
});

function bundledOpencodeExecutable(
  platform = process.platform,
  architecture = process.arch,
  resourcesPath: string | null | undefined = process.resourcesPath,
): string | null {
  return bundledProviderExecutable("opencode", platform, architecture, resourcesPath);
}

function bundledGrokExecutable(
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

export function parseOpencodeVersion(output: string): string {
  const match = output.trim().match(/^(?:opencode\s+)?v?(\d+)\.(\d+)\.(\d+)(?:[-+][\w.-]+)?$/i);
  if (!match) throw new CodexCliError(sourceText("error.provider.opencodeVersionUnreadable"), "invalid");
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

export function parseClineVersion(output: string): string {
  const match = output.trim().match(/^(?:cline\s+)?v?(\d+)\.(\d+)\.(\d+)(?:[-+][\w.-]+)?$/i);
  if (!match) throw new CodexCliError(sourceText("error.provider.clineVersionUnreadable"), "invalid");
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

export function parseKimiVersion(output: string): string {
  const match = output.trim().match(/^(?:kimi,?\s+version\s+)?v?(\d+)\.(\d+)\.(\d+)(?:[-+.][\w.-]+)?$/i);
  if (!match) throw new CodexCliError(sourceText("error.provider.kimiVersionUnreadable"), "invalid");
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

export function parseBunVersion(output: string): string {
  const match = output.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+][\w.-]+)?$/);
  if (!match) throw new CodexCliError(sourceText("error.provider.bunVersionUnreadable"), "invalid");
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

export function claudeTakesPromptSnapshotFlag(version: string): boolean {
  return isMinimumVersion(version, [2, 1, 263]);
}

export function antigravityTakesStateFolders(version: string): boolean {
  return isMinimumVersion(version, [1, 5, 3]);
}

function isMinimumVersion(version: string, minimum: readonly number[]): boolean {
  const parts = version.split(".").map(Number);
  for (const [index, required] of minimum.entries()) {
    const part = parts[index] ?? Number.NaN;
    if (part > required) return true;
    if (part < required) return false;
  }
  return true;
}

const resolveNativeCli = Effect.fn("Cli.resolveNativeCli")(function* (
  provider: NativeCliProvider,
  input: { systemCandidates?: string[]; bundledExecutable?: string | null | undefined } = {},
): Effect.fn.Return<AgentCliInfo, ProviderClientOperationError> {
  const candidates = yield* cliCandidates(provider, input.systemCandidates, input.bundledExecutable ?? null);
  let found = false;
  let outdated: CodexCliError | undefined;
  for (const candidate of candidates) {
    if (provider === "muse" && isWindowsLauncherScript(candidate.executable)) continue;
    if (!(yield* isExecutable(candidate.executable))) continue;
    found = true;
    const attempt = yield* Effect.result(
      Effect.gen(function* () {
        const { stdout, launch } = yield* readCliVersion(candidate, provider);
        const version = NATIVE_VERSION_PARSERS[provider](stdout);
        if (provider === "pi" && !isMinimumVersion(version, [1, 1, 0]))
          throw new CodexCliError(sourceText("error.provider.piOutdated", { version }), "outdated");
        return { executable: candidate.executable, version, source: candidate.source, ...launch };
      }).pipe(Effect.catchDefect((cause) => Effect.fail(providerFailure(cause)))),
    );
    if (Result.isSuccess(attempt)) return attempt.success;
    if (attempt.failure.cause instanceof CodexCliError && attempt.failure.cause.code === "outdated")
      outdated = attempt.failure.cause;
    if (isCliTimeout(attempt.failure.cause)) return yield* Effect.fail(attempt.failure);
  }
  if (outdated) return yield* Effect.fail(providerFailure(outdated));
  return yield* Effect.fail(
    providerFailure(
      new CodexCliError(
        sourceText(found ? "error.provider.nativeNotStarted" : "error.provider.nativeMissing", {
          provider: agentProviderName(provider),
        }),
        found ? "invalid" : "missing",
      ),
    ),
  );
});

export const resolvePiCli = (input?: { systemCandidates?: string[]; bundledExecutable?: string | null | undefined }) =>
  resolveNativeCli("pi", input);
export const resolveMuseCli = (input?: {
  systemCandidates?: string[];
  bundledExecutable?: string | null | undefined;
}) => resolveNativeCli("muse", input);
export const resolveDevinCli = (input?: {
  systemCandidates?: string[];
  bundledExecutable?: string | null | undefined;
}) => resolveNativeCli("devin", input);
export const resolveCopilotCli = (input?: {
  systemCandidates?: string[];
  bundledExecutable?: string | null | undefined;
}) => resolveNativeCli("copilot", input);
export const resolveMistralCli = (input?: {
  systemCandidates?: string[];
  bundledExecutable?: string | null | undefined;
}) => resolveNativeCli("mistral", input);

function parsePiVersion(output: string): string {
  const match = output.trim().match(/(?:^|\s)v?(\d+\.\d+\.\d+)(?:[-+][\w.-]+)?(?:\s|$)/u);
  if (!match?.[1])
    throw new CodexCliError(sourceText("error.provider.nativeVersionUnreadable", { provider: "Pi" }), "invalid");
  return match[1];
}
function parseMuseVersion(output: string): string {
  const match = output.match(/\b\d+\.\d+\.\d+-R\d+(?:\.\d+)?\b/u) ?? output.match(/\b\d+\.\d+\.\d+\b/u);
  if (!match)
    throw new CodexCliError(sourceText("error.provider.nativeVersionUnreadable", { provider: "Muse" }), "invalid");
  return match[0];
}

function parseDevinVersion(output: string): string {
  const match = output.match(/\bdevin[ \t]+v?(\d+\.\d+\.\d+)\b/iu) ?? output.match(/\b\d+\.\d+\.\d+\b/u);
  if (!match)
    throw new CodexCliError(sourceText("error.provider.nativeVersionUnreadable", { provider: "Devin" }), "invalid");
  return match[1] ?? match[0];
}

function parseCopilotVersion(output: string): string {
  const match = output.match(/\bCopilot CLI[ \t]+v?(\d+\.\d+\.\d+)\b/iu) ?? output.match(/\b\d+\.\d+\.\d+\b/u);
  if (!match)
    throw new CodexCliError(
      sourceText("error.provider.nativeVersionUnreadable", { provider: "GitHub Copilot" }),
      "invalid",
    );
  return match[1] ?? match[0];
}

function parseMistralVersion(output: string): string {
  const match = output.match(/\bvibe-acp[ \t]+v?(\d+\.\d+\.\d+)\b/iu) ?? output.match(/\b\d+\.\d+\.\d+\b/u);
  if (!match)
    throw new CodexCliError(
      sourceText("error.provider.nativeVersionUnreadable", { provider: "Mistral Vibe" }),
      "invalid",
    );
  return match[1] ?? match[0];
}

export const COPILOT_ENV: Readonly<Record<string, string>> = { COPILOT_AUTO_UPDATE: "false" };

export const ANTIGRAVITY_UPDATE_ENV: Readonly<Record<string, string>> = { AGY_CLI_DISABLE_AUTO_UPDATE: "true" };

const VERSION_READ_ENV: Partial<Record<AgentProviderId, Readonly<Record<string, string>>>> = {
  copilot: COPILOT_ENV,
  antigravity: ANTIGRAVITY_UPDATE_ENV,
};

type NativeCliProvider = "pi" | "muse" | "devin" | "copilot" | "mistral" | "antigravity";

export const NATIVE_VERSION_PARSERS: Readonly<Record<NativeCliProvider, (output: string) => string>> = {
  pi: parsePiVersion,
  muse: parseMuseVersion,
  devin: parseDevinVersion,
  copilot: parseCopilotVersion,
  mistral: parseMistralVersion,
  antigravity: parseAntigravityVersion,
};

export function resolveInstalledFirst<Cli extends AgentCliInfo, E>(
  resolve: (input: { bundledExecutable?: string | null }) => Effect.Effect<Cli, E>,
  bundledExecutable: string | null | undefined,
  preferInstalled: boolean,
  installedChosen = false,
): Effect.Effect<Cli, E> {
  return chooseInstalledFirst(resolve, bundledExecutable, preferInstalled, installedChosen).pipe(
    Effect.map((choice) => choice.cli),
  );
}

export interface InstalledFirstChoice<Cli> {
  readonly cli: Cli;
  readonly passedOver: {
    readonly source: "system" | "managed";
    readonly version: string;
    readonly incomplete?: boolean;
  } | null;
}

export function chooseInstalledFirst<Cli extends AgentCliInfo, E>(
  resolve: (input: { bundledExecutable?: string | null }) => Effect.Effect<Cli, E>,
  bundledExecutable: string | null | undefined,
  preferInstalled: boolean,
  installedChosen = false,
): Effect.Effect<InstalledFirstChoice<Cli>, E> {
  const copy = resolve(bundledExecutable === undefined ? {} : { bundledExecutable });
  const installedCli = resolve({ bundledExecutable: null }).pipe(Effect.orElseSucceed(() => null));
  const choose = (resolved: Cli, installed: Cli | null): InstalledFirstChoice<Cli> => {
    if (resolved.source !== "managed" || installed?.source !== "system") return { cli: resolved, passedOver: null };
    const asNew = installed.version === resolved.version || olderVersion(resolved.version, installed.version);
    if (preferInstalled && (installedChosen || (asNew && !installed.incomplete))) {
      const copyOffered = installed.incomplete || olderVersion(installed.version, resolved.version);
      return { cli: installed, passedOver: copyOffered ? { source: "managed", version: resolved.version } : null };
    }
    return {
      cli: resolved,
      passedOver: {
        source: "system",
        version: installed.version,
        ...(installed.incomplete ? { incomplete: true } : {}),
      },
    };
  };
  return Effect.gen(function* () {
    if (bundledExecutable) {
      const [resolved, installed] = yield* Effect.all([copy, installedCli], { concurrency: 2 });
      return choose(resolved, installed);
    }
    const resolved = yield* copy;
    return resolved.source === "managed" ? choose(resolved, yield* installedCli) : { cli: resolved, passedOver: null };
  });
}

function cliCommandName(provider: AgentProviderId): string {
  return provider === "cursor" ? "cursor-agent" : provider === "mistral" ? "vibe-acp" : provider;
}

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

const collectCandidates = Effect.fn("Cli.collectCandidates")(function* (
  provider: AgentProviderId,
  configuredPath: string | undefined,
) {
  const candidates: string[] = [];
  const override = configuredPath?.trim();
  if (override) return [override];
  const command = cliCommandName(provider);
  if (process.platform === "win32") {
    const searchPath = windowsPathWithRegistry(process.env, yield* windowsRegistryPathFolders());
    const output = yield* providerCall(() =>
      execFileAsync("where.exe", [command], {
        timeout: 5_000,
        maxBuffer: 64 * 1024,
        ...(searchPath ? { env: withWindowsPath(process.env, searchPath) } : {}),
      }),
    ).pipe(Effect.catch(() => Effect.succeed({ stdout: "" })));
    candidates.push(
      ...output.stdout
        .split(/\r?\n/u)
        .map((path) => path.trim())
        .filter((path) => isWindowsRunnable(path, process.env.PATHEXT)),
    );
    candidates.push(...windowsFallbackPaths(provider));
  } else {
    for (const folder of yield* loginSearchPath()) {
      if (isAbsolute(folder)) candidates.push(join(folder, command));
    }
    candidates.push(...posixFallbackPaths(provider));
  }
  return [...new Set(candidates)];
});

const WINDOWS_PATH_KEYS = [
  "HKCU\\Environment",
  "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
];

let pendingRegistryPathRead: Promise<string[]> | null = null;

async function readWindowsRegistryPathFolders(): Promise<string[]> {
  const reg = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "reg.exe");
  const values = await Promise.all(
    WINDOWS_PATH_KEYS.map(
      (key) =>
        new Promise<string>((resolve) => {
          execFile(reg, ["query", key, "/v", "Path"], { timeout: 5_000, windowsHide: true }, (error, stdout) => {
            resolve(error ? "" : (/^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/imu.exec(stdout)?.[1] ?? ""));
          });
        }),
    ),
  );
  return values
    .flatMap((value) => value.split(";"))
    .map((folder) => folder.trim().replace(/%([^%]+)%/gu, (text, name: string) => process.env[name] ?? text))
    .filter((folder) => folder.length > 0);
}

export const windowsRegistryPathFolders = Effect.fn("Cli.windowsRegistryPathFolders")(function* () {
  if (!pendingRegistryPathRead) {
    const read = readWindowsRegistryPathFolders().finally(() => {
      if (pendingRegistryPathRead === read) pendingRegistryPathRead = null;
    });
    pendingRegistryPathRead = read;
  }
  const read = pendingRegistryPathRead;
  return yield* Effect.promise(() => read);
});

function windowsPathKey(folder: string): string {
  return folder.trim().replace(/\\+$/u, "").toLowerCase();
}

function windowsPathWithRegistry(environment: NodeJS.ProcessEnv, registryFolders: string[]): string | null {
  const current = Object.entries(environment).find(([key]) => key.toUpperCase() === "PATH")?.[1] ?? "";
  const known = new Set(current.split(";").map(windowsPathKey));
  const added: string[] = [];
  for (const folder of registryFolders) {
    const key = windowsPathKey(folder);
    if (!key || known.has(key)) continue;
    known.add(key);
    added.push(folder);
  }
  if (added.length === 0) return null;
  return [current, ...added].filter((part) => part.length > 0).join(";");
}

function withWindowsPath(environment: NodeJS.ProcessEnv, path: string): NodeJS.ProcessEnv {
  const rest = Object.fromEntries(Object.entries(environment).filter(([key]) => key.toUpperCase() !== "PATH"));
  return { ...rest, Path: path };
}

const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

export function isWindowsRunnable(path: string, pathext: string | undefined): boolean {
  const dot = path.lastIndexOf(".");
  if (dot <= Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"))) return false;
  const extension = path.slice(dot).toLowerCase();
  return (pathext?.trim() || DEFAULT_PATHEXT).split(";").some((entry) => entry.trim().toLowerCase() === extension);
}

function windowsFallbackPaths(
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
  if (command === "cursor-agent" && localAppData) {
    paths.push(win32.join(localAppData, "cursor-agent", "cursor-agent.cmd"));
  }
  if (command === "grok") {
    paths.push(win32.join(userHome, ".grok", "bin", "grok.exe"));
    if (localAppData) paths.push(win32.join(localAppData, "Microsoft", "WinGet", "Links", "grok.exe"));
  }
  if (command === "opencode") {
    paths.push(win32.join(userHome, ".opencode", "bin", "opencode.exe"));
    if (localAppData) paths.push(win32.join(localAppData, "Microsoft", "WinGet", "Links", "opencode.exe"));
  }
  if (command === "kimi") paths.push(win32.join(userHome, ".kimi-code", "bin", "kimi.exe"));
  if (command === "hermes") {
    const configuredRoot = environment.HERMES_HOME?.trim();
    const hermesRoots = [
      ...(configuredRoot ? [configuredRoot] : []),
      ...(localAppData ? [win32.join(localAppData, "hermes")] : []),
    ];
    for (const hermesRoot of hermesRoots) {
      paths.push(win32.join(hermesRoot, "bin", "hermes.exe"), win32.join(hermesRoot, "bin", "hermes.cmd"));
    }
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

const MAC_LOGIN_SHELLS = new Set(["bash", "fish", "ksh", "sh", "zsh"]);

function loginShellCommand(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): { command: string; args: string[] } {
  const preferred = environment.SHELL?.trim();
  if (platform !== "linux") {
    if (!preferred || !isAbsolute(preferred) || !MAC_LOGIN_SHELLS.has(basename(preferred))) {
      return { command: "/bin/zsh", args: ["-lic"] };
    }
  } else if (!preferred) {
    return { command: "/bin/sh", args: ["-lc"] };
  }
  return { command: preferred, args: preferred.endsWith("/sh") ? ["-lc"] : ["-lic"] };
}

const LOGIN_SHELL_TIMEOUT_MS = 5_000;
const LOGIN_SHELL_MAX_OUTPUT_BYTES = 64 * 1024;

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
    const stop = (error: Error) => {
      if (failure) return;
      failure = error;
      child.stdout.destroy();
      child.stderr.destroy();
      try {
        if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      } catch {}
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

const LOGIN_PATH_TTL_MS = 60_000;

let loginPath: { value: Deferred.Deferred<readonly string[]>; readAt: number } | null = null;

export const loginSearchPath = Effect.fn("Cli.loginSearchPath")(function* () {
  if (loginPath && Date.now() - loginPath.readAt < LOGIN_PATH_TTL_MS) return yield* Deferred.await(loginPath.value);
  const value = Deferred.makeUnsafe<readonly string[]>();
  loginPath = { value, readAt: Date.now() };
  const exit = yield* Effect.exit(
    runInLoginShell('printf %s "$PATH"').pipe(
      Effect.catch(() => Effect.succeed("")),
      Effect.map((stdout) => stdout.split(/\r?\n/u).pop()?.trim() ?? ""),
      Effect.map((shellPath) => [
        ...new Set([...shellPath.split(delimiter), ...(process.env.PATH ?? "").split(delimiter)].filter(Boolean)),
      ]),
    ),
  );
  yield* Deferred.done(value, exit);
  return yield* exit;
}, Effect.uninterruptible);

export const agentLaunchPath = Effect.fn("Cli.agentLaunchPath")(function* (
  platform: NodeJS.Platform = process.platform,
) {
  if (platform === "win32") return null;
  const folders = (yield* loginSearchPath()).filter((folder) => isAbsolute(folder));
  return folders.length > 0 ? folders.join(delimiter) : null;
});

export const cliLaunchPath = Effect.fn("Cli.launchPath")(function* (
  executable: string,
  source: "system" | "managed" | undefined,
  platform: NodeJS.Platform = process.platform,
) {
  if (platform === "win32") return null;
  const folders = (yield* agentLaunchPath(platform))?.split(delimiter) ?? [];
  const own = dirname(executable);
  if (source === "system" && !folders.includes(own)) folders.push(own);
  return folders.length > 0 ? folders.join(delimiter) : null;
});

export function cliPathEnvironment(cli: { readonly launchPath?: string }): Record<string, string> {
  return cli.launchPath ? { PATH: cli.launchPath } : {};
}

function posixFallbackPaths(
  provider: AgentProviderId,
  userHome = homedir(),
  platform: NodeJS.Platform = process.platform,
): string[] {
  const command = cliCommandName(provider);
  const paths = [posix.join(userHome, ".local", "bin", command)];
  if (command === "claude") paths.push(posix.join(userHome, ".claude", "local", "claude"));
  if (command === "opencode") paths.push(posix.join(userHome, ".opencode", "bin", "opencode"));
  if (command === "grok") paths.push(posix.join(userHome, ".grok", "bin", "grok"));
  if (command === "kimi") paths.push(posix.join(userHome, ".kimi-code", "bin", "kimi"));
  paths.push(
    posix.join(userHome, ".npm-global", "bin", command),
    posix.join(userHome, ".volta", "bin", command),
    posix.join(userHome, ".bun", "bin", command),
    platform === "darwin"
      ? posix.join(userHome, "Library", "pnpm", command)
      : posix.join(userHome, ".local", "share", "pnpm", command),
    `/opt/homebrew/bin/${command}`,
    `/usr/local/bin/${command}`,
    `/usr/bin/${command}`,
  );
  return paths;
}

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

function isWindowsLauncherScript(executable: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform === "win32" && [".bat", ".cmd"].includes(extname(executable).toLowerCase());
}

export function cliSpawnTarget(
  executable: string,
  argv: readonly string[],
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[]; windowsVerbatimArguments: boolean } {
  if (!isWindowsLauncherScript(executable, platform)) {
    return { command: executable, args: [...argv], windowsVerbatimArguments: false };
  }

  const commandLine = [`"${executable.replaceAll("%", "%%")}"`, ...argv.map(batchArgument)].join(" ");
  return {
    command: process.env.ComSpec?.trim() || "cmd.exe",
    args: ["/d", "/s", "/c", `"${commandLine}"`],
    windowsVerbatimArguments: true,
  };
}

const CLI_VERSION_TIMEOUT_MS = 10_000;
const ANTIGRAVITY_VERSION_TIMEOUT_MS = 90_000;
const SLOW_CLI_VERSION_TIMEOUT_MS = 120_000;
const slowVersionReads = new Set<string>();

function isCliTimeout(error: unknown): error is CodexCliError {
  return error instanceof CodexCliError && error.code === "timeout";
}

const readCliVersion = Effect.fn("Cli.readVersion")(function* (
  { executable: candidate, source }: { executable: string; source: "system" | "managed" },
  provider: AgentProviderId,
  args: readonly string[] = ["--version"],
) {
  const launchPath = yield* cliLaunchPath(candidate, source);
  const launch = launchPath ? { launchPath } : {};
  const target = isWindowsLauncherScript(candidate);
  const slow = slowVersionReads.has(candidate);
  const firstTimeout = provider === "antigravity" ? ANTIGRAVITY_VERSION_TIMEOUT_MS : CLI_VERSION_TIMEOUT_MS;
  const timeout = providerCheckTimeoutMs(slow ? SLOW_CLI_VERSION_TIMEOUT_MS : firstTimeout);
  const providerEnv = VERSION_READ_ENV[provider] ?? {};
  const output = yield* Effect.tryPromise({
    try: (signal) =>
      target
        ? execFileAsync(
            process.env.ComSpec?.trim() || "cmd.exe",
            ["/d", "/s", "/c", `""${candidate.replaceAll("%", "%%")}" ${args.join(" ")}"`],
            {
              signal,
              timeout,
              maxBuffer: 64 * 1024,
              env: { ...process.env, ...providerEnv },
              windowsHide: true,
              windowsVerbatimArguments: true,
            },
          )
        : execFileAsync(candidate, [...args], {
            signal,
            timeout,
            maxBuffer: 64 * 1024,
            windowsHide: process.platform === "win32",
            env: { ...process.env, ...providerEnv, ...cliPathEnvironment(launch) },
          }),
    catch: providerFailure,
  }).pipe(
    Effect.mapError((failure) => {
      if (!(isDynamicRecord(failure.cause) && failure.cause.killed === true)) return failure;
      if (slow) slowVersionReads.delete(candidate);
      else slowVersionReads.add(candidate);
      return providerFailure(
        new CodexCliError(
          sourceText("error.provider.cliTimedOutRefresh", { provider: agentProviderName(provider) }),
          "timeout",
        ),
      );
    }),
  );
  return { stdout: output.stdout, launch };
});

export const isExecutable = Effect.fn("Cli.isExecutable")((path: string) =>
  providerCall(async () => {
    await access(path, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return await stat(path).then(
      (info) => info.isFile(),
      async (error: unknown) => {
        if (process.platform !== "win32" || !isDynamicRecord(error) || error.code !== "EACCES") throw error;
        return (await lstat(path)).isSymbolicLink();
      },
    );
  }).pipe(Effect.match({ onSuccess: (file) => file, onFailure: () => false })),
);
