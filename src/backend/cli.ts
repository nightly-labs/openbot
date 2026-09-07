import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, posix, resolve, win32 } from "node:path";
import { promisify } from "node:util";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { type DiagnosticSink, recordDiagnostic, redactText, toLogValue } from "@openbot/logging";

const execFileAsync = promisify(execFile);
const MINIMUM_CODEX_VERSION = [0, 144, 1] as const;
const MINIMUM_CLAUDE_VERSION = [2, 1, 232] as const;
const MINIMUM_GROK_VERSION = [1, 0, 5] as const;

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

export type AgentCliInfo = CodexCliInfo | ClaudeCliInfo | GrokCliInfo;

export class CodexCliError extends Error {
  constructor(
    message: string,
    readonly code: "missing" | "invalid" | "outdated",
  ) {
    super(message);
    this.name = "CodexCliError";
  }
}

/**
 * What happened to one candidate binary. The whole array is reported when a
 * resolve fails, because "ChatGPT is not downloaded" was true of a machine that
 * had four codex binaries on it, three of them unreadable for three different
 * reasons, and none of that reached a log.
 */
export interface CandidateAttempt {
  path: string;
  source: "system" | "managed";
  outcome: "not-executable" | "probe-failed" | "unparsable" | "outdated" | "ok";
  errno?: string;
  exitCode?: number;
  /** `SIGTERM` is the five-second timeout, which is a different bug from `EACCES`. */
  signal?: string;
  version?: string;
  stdoutHead?: string;
  durationMs: number;
}

export interface ResolveCliInput {
  systemCandidates?: string[];
  bundledExecutable?: string | null;
  /** Defaults to the process-wide sink, so no test has to register one globally. */
  onDiagnostic?: DiagnosticSink;
}

interface ProviderCliSpec {
  command: "codex" | "claude" | "grok";
  environmentPath: string | undefined;
  bundled: () => string | null;
  parseVersion: (output: string) => string;
  minimum: readonly number[];
  outdated: (version: string) => string;
  invalidCandidate: string;
  invalidAll: string;
  missing: string;
}

export async function resolveCodexCli(input: ResolveCliInput = {}): Promise<CodexCliInfo> {
  return resolveProviderCli(
    {
      command: "codex",
      environmentPath: process.env.OPENBOT_CODEX_PATH,
      bundled: bundledCodexExecutable,
      parseVersion: parseCodexVersion,
      minimum: MINIMUM_CODEX_VERSION,
      outdated: (version) => `Codex CLI ${version} is too old. OpenBot requires 0.144.1 or newer.`,
      invalidCandidate: "Codex CLI was found but could not be started.",
      invalidAll: "Codex CLI was found but could not be started. Run `codex --version` in a new terminal.",
      missing: "ChatGPT is not downloaded. Download it in OpenBot to continue.",
    },
    input,
  );
}

export function bundledCodexExecutable(
  platform = process.platform,
  architecture = process.arch,
  resourcesPath: string | null | undefined = process.resourcesPath,
): string | null {
  return bundledProviderExecutable("codex", platform, architecture, resourcesPath);
}

export async function resolveClaudeCli(input: ResolveCliInput = {}): Promise<ClaudeCliInfo> {
  return resolveProviderCli(
    {
      command: "claude",
      environmentPath: process.env.OPENBOT_CLAUDE_PATH,
      bundled: bundledClaudeExecutable,
      parseVersion: parseClaudeVersion,
      minimum: MINIMUM_CLAUDE_VERSION,
      outdated: (version) => `Claude Code ${version} is too old. OpenBot requires 2.1.232 or newer.`,
      invalidCandidate: "Claude CLI was found but could not be started.",
      invalidAll: "Claude CLI was found but could not be started. Run `claude --version` in a new terminal.",
      missing: "Claude is not downloaded. Download it in OpenBot to continue.",
    },
    input,
  );
}

export function bundledClaudeExecutable(
  platform = process.platform,
  architecture = process.arch,
  resourcesPath: string | null | undefined = process.resourcesPath,
): string | null {
  return bundledProviderExecutable("claude", platform, architecture, resourcesPath);
}

export async function resolveGrokCli(input: ResolveCliInput = {}): Promise<GrokCliInfo> {
  return resolveProviderCli(
    {
      command: "grok",
      environmentPath: process.env.OPENBOT_GROK_PATH,
      bundled: bundledGrokExecutable,
      parseVersion: parseGrokVersion,
      minimum: MINIMUM_GROK_VERSION,
      outdated: (version) => `Grok CLI ${version} is too old. OpenBot requires 1.0.5 or newer.`,
      invalidCandidate: "Grok CLI was found but could not be started.",
      invalidAll: "Grok CLI was found but could not be started. Run `grok --version` in a new terminal.",
      missing: "Grok is not downloaded. Download it in OpenBot to continue.",
    },
    input,
  );
}

/**
 * One resolver for the three providers. They differ in a version pattern, a
 * minimum and four sentences; they used to differ in three copies of the same
 * loop, which is why instrumenting the loop once is worth the parameters.
 */
async function resolveProviderCli(
  spec: ProviderCliSpec,
  input: ResolveCliInput,
): Promise<{ executable: string; version: string; source: "system" | "managed" }> {
  const report = input.onDiagnostic ?? recordDiagnostic;
  const systemCandidates =
    input.systemCandidates ?? (await collectCandidates(spec.command, spec.environmentPath, report));
  const bundledExecutable = input.bundledExecutable === undefined ? spec.bundled() : input.bundledExecutable;
  const candidates = [
    ...systemCandidates.map((executable) => ({ executable, source: "system" as const })),
    ...(bundledExecutable ? [{ executable: bundledExecutable, source: "managed" as const }] : []),
  ].filter((candidate, index, all) => all.findIndex((other) => other.executable === candidate.executable) === index);
  const failures: CodexCliError[] = [];
  const attempts: CandidateAttempt[] = [];

  for (const candidate of candidates) {
    const startedAt = Date.now();
    const base = { path: candidate.executable, source: candidate.source };
    const probe = await probeExecutable(candidate.executable);
    if (!probe.ok) {
      attempts.push({ ...base, outcome: "not-executable", ...probe, durationMs: Date.now() - startedAt });
      continue;
    }

    let stdout: string;
    try {
      stdout = await readCliVersion(candidate.executable);
    } catch (error) {
      attempts.push({ ...base, outcome: "probe-failed", ...execFailure(error), durationMs: Date.now() - startedAt });
      failures.push(new CodexCliError(spec.invalidCandidate, "invalid"));
      continue;
    }

    let version: string;
    try {
      version = spec.parseVersion(stdout);
    } catch {
      attempts.push({
        ...base,
        outcome: "unparsable",
        stdoutHead: redactText(stdout).slice(0, 120),
        durationMs: Date.now() - startedAt,
      });
      failures.push(new CodexCliError(spec.invalidCandidate, "invalid"));
      continue;
    }

    if (!isMinimumVersion(version, spec.minimum)) {
      attempts.push({ ...base, outcome: "outdated", version, durationMs: Date.now() - startedAt });
      failures.push(new CodexCliError(spec.outdated(version), "outdated"));
      continue;
    }

    attempts.push({ ...base, outcome: "ok", version, durationMs: Date.now() - startedAt });
    // A resolve that succeeded on the fourth candidate is a machine one release
    // away from failing outright, and it reports nothing else.
    if (attempts.length > 1) {
      report({
        code: "cli_resolved_after_failures",
        severity: "warn",
        area: "provider",
        stage: "provider_start",
        detail: { provider: spec.command, attempts: toLogValue(attempts) },
      });
    }
    return { executable: candidate.executable, version, source: candidate.source };
  }

  const outdated = failures.find((failure) => failure.code === "outdated");
  const errorCode = outdated ? "outdated" : failures.length > 0 ? "invalid" : "missing";
  report({
    code: "cli_resolve_failed",
    severity: "error",
    area: "provider",
    stage: "provider_start",
    message: outdated?.message ?? (failures.length > 0 ? spec.invalidAll : spec.missing),
    detail: { provider: spec.command, errorCode, attempts: toLogValue(attempts) },
  });
  if (outdated) throw outdated;
  if (failures.length > 0) throw new CodexCliError(spec.invalidAll, "invalid");
  throw new CodexCliError(spec.missing, "missing");
}

function execFailure(error: unknown): Pick<CandidateAttempt, "errno" | "exitCode" | "signal"> {
  if (!isDynamicRecord(error)) return {};
  return {
    ...(isString(error.code) ? { errno: error.code } : {}),
    ...(isNumber(error.code) ? { exitCode: error.code } : {}),
    ...(isString(error.signal) ? { signal: error.signal } : {}),
  };
}

export function bundledGrokExecutable(
  platform = process.platform,
  architecture = process.arch,
  resourcesPath: string | null | undefined = process.resourcesPath,
): string | null {
  return bundledProviderExecutable("grok", platform, architecture, resourcesPath);
}

function bundledProviderExecutable(
  provider: "codex" | "claude" | "grok",
  platform: NodeJS.Platform,
  architecture: string,
  resourcesPath: string | null | undefined,
): string | null {
  const targetPlatform =
    platform === "darwin" && architecture === "arm64"
      ? "mac"
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
  if (!match) throw new CodexCliError("Unable to read the Codex CLI version.", "invalid");
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

export function parseClaudeVersion(output: string): string {
  const match = output.match(/(\d+)\.(\d+)\.(\d+)(?:\s+\(Claude Code\))?/i);
  if (!match) throw new CodexCliError("Unable to read the Claude CLI version.", "invalid");
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

export function parseGrokVersion(output: string): string {
  const match = output.match(/(?:grok(?:-cli)?\s+)?v?(\d+)\.(\d+)\.(\d+)/i);
  if (!match) throw new CodexCliError("Unable to read the Grok CLI version.", "invalid");
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

function isMinimumVersion(version: string, minimum: readonly number[]): boolean {
  const parts = version.split(".").map(Number);
  for (let index = 0; index < minimum.length; index += 1) {
    if (parts[index] > minimum[index]) return true;
    if (parts[index] < minimum[index]) return false;
  }
  return true;
}

async function collectCandidates(
  command: "codex" | "claude" | "grok",
  configuredPath: string | undefined,
  report: DiagnosticSink,
): Promise<string[]> {
  const candidates: string[] = [];
  const override = configuredPath?.trim();
  if (override) return [override];

  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync("where.exe", [command], {
        timeout: 5_000,
        maxBuffer: 64 * 1024,
      });
      candidates.push(
        ...stdout
          .split(/\r?\n/u)
          .map((path) => path.trim())
          .filter(Boolean),
      );
    } catch (error) {
      // Known Windows install locations are checked next.
      report({
        code: "cli_candidate_discovery_failed",
        severity: "warn",
        area: "provider",
        stage: "provider_start",
        detail: { provider: command, probe: "where.exe", ...execFailure(error) },
      });
    }
    candidates.push(...windowsFallbackPaths(command));
  } else {
    try {
      const { stdout } = await execFileAsync("/bin/zsh", ["-lic", `command -v ${command}`], {
        timeout: 5_000,
        maxBuffer: 64 * 1024,
      });
      if (stdout.trim()) candidates.push(stdout.trim());
    } catch (error) {
      // Packaged macOS apps often have a restricted PATH; known locations are
      // checked next. This is the probe that fails on a packaged macOS build,
      // and it was one of the two blank catches behind the reported bug.
      report({
        code: "cli_candidate_discovery_failed",
        severity: "warn",
        area: "provider",
        stage: "provider_start",
        detail: { provider: command, probe: "zsh -lic", ...execFailure(error) },
      });
    }
    candidates.push(...posixFallbackPaths(command));
  }

  return [...new Set(candidates)];
}

export function windowsFallbackPaths(
  command: "codex" | "claude" | "grok",
  userHome = homedir(),
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  const paths: string[] = [];
  const appData = environment.APPDATA?.trim();
  const localAppData = environment.LOCALAPPDATA?.trim();

  if (command === "codex" && localAppData) {
    paths.push(win32.join(localAppData, "Programs", "OpenAI", "Codex", "bin", "codex.exe"));
  }
  if (command === "claude" && localAppData) {
    paths.push(win32.join(localAppData, "Microsoft", "WinGet", "Links", "claude.exe"));
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

export function posixFallbackPaths(command: "codex" | "claude" | "grok", userHome = homedir()): string[] {
  const paths = [posix.join(userHome, ".local", "bin", command)];
  if (command === "claude") paths.push(posix.join(userHome, ".claude", "local", "claude"));
  if (command === "grok") paths.push(posix.join(userHome, ".grok", "bin", "grok"));
  paths.push(`/opt/homebrew/bin/${command}`, `/usr/local/bin/${command}`);
  return paths;
}

async function readCliVersion(candidate: string): Promise<string> {
  if (process.platform === "win32" && [".bat", ".cmd"].includes(extname(candidate).toLowerCase())) {
    const commandProcessor = process.env.ComSpec?.trim() || "cmd.exe";
    const escapedCandidate = candidate.replaceAll("%", "%%");
    const { stdout } = await execFileAsync(commandProcessor, ["/d", "/s", "/c", `""${escapedCandidate}" --version"`], {
      timeout: 5_000,
      maxBuffer: 64 * 1024,
      windowsHide: true,
      windowsVerbatimArguments: true,
    });
    return stdout;
  }

  const { stdout } = await execFileAsync(candidate, ["--version"], {
    timeout: 5_000,
    maxBuffer: 64 * 1024,
    windowsHide: process.platform === "win32",
  });
  return stdout;
}

/** The errno is the whole diagnostic: `ENOENT` and `EACCES` are different bugs with the same symptom. */
async function probeExecutable(path: string): Promise<{ ok: boolean; errno?: string }> {
  try {
    await access(path, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return { ok: true };
  } catch (error) {
    return { ok: false, ...(isDynamicRecord(error) && isString(error.code) ? { errno: error.code } : {}) };
  }
}
