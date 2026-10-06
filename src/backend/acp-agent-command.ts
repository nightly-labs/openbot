// Where a custom agent's command is on this computer, and whether it can start with its arguments.
//
// The command is text the user typed. It never goes into a shell: a bare name is looked up here, in
// Node, in the `PATH` that a login shell reports through one fixed script. On Windows `where.exe`
// takes the name as one argument. What comes back is the file that `spawn` runs.

import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, extname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { CUSTOM_AGENT_LIMITS } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect } from "effect";
import { runInLoginShell } from "./cli";
import { pickWindowsExecutable } from "./mcp-provider-shapes";
import { providerCall, providerFailure } from "./provider-client-effects";

const execFileAsync = promisify(execFile);

/** A command name with no path, no shell text and no option form. */
const AGENT_COMMAND_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;

/**
 * What a `.cmd` or `.bat` argument may hold. Such a file runs only through `cmd.exe`, and
 * `cliSpawnTarget` gives it one command line, so any other character could start a second command.
 */
const WINDOWS_SCRIPT_ARG_PATTERN = /^[A-Za-z0-9_.,:=@+/\\-]+$/;

/** How long the login shell's `PATH` is kept. A tool the user installs is found after this. */
const LOGIN_PATH_TTL_MS = 60_000;

export type AgentCommandForm = "path" | "home" | "name";

/** The form of the command text, or null when it is none of the three forms that are accepted. */
export function agentCommandForm(
  command: string,
  platform: NodeJS.Platform = process.platform,
): AgentCommandForm | null {
  if (command.length === 0 || command.length > CUSTOM_AGENT_LIMITS.command) return null;
  if (/[\0\r\n]/.test(command) || command !== command.trim()) return null;
  if (command.startsWith("~/")) return "home";
  if (isAbsolute(command) || (platform === "win32" && /^[A-Za-z]:[\\/]/.test(command))) return "path";
  return AGENT_COMMAND_NAME_PATTERN.test(command) ? "name" : null;
}

/** Throws the reason when an argument list cannot be given to a process. */
export function assertAgentArgs(args: readonly string[]): void {
  if (args.length > CUSTOM_AGENT_LIMITS.args) throw new Error(sourceText("error.provider.customAgentArgsInvalid"));
  for (const arg of args) {
    if (arg.length > CUSTOM_AGENT_LIMITS.arg || /[\0\r\n]/.test(arg)) {
      throw new Error(sourceText("error.provider.customAgentArgsInvalid"));
    }
  }
}

/**
 * Throws when the resolved file is a Windows script and an argument could leave the one command line
 * that `cmd.exe` gets. Called with the resolved file, because a bare name can resolve to `x.cmd`.
 */
export function assertWindowsScriptArgs(
  executable: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform !== "win32" || ![".cmd", ".bat"].includes(extname(executable).toLowerCase())) return;
  if (executable.includes('"') || args.some((arg) => !WINDOWS_SCRIPT_ARG_PATTERN.test(arg))) {
    throw new Error(sourceText("error.provider.customAgentWindowsScript"));
  }
}

export interface ResolveAgentCommandOptions {
  platform?: NodeJS.Platform;
  home?: string;
  /** The folders to search for a bare name. The login shell's `PATH` and this process's when absent. */
  searchPath?: readonly string[];
}

/**
 * The file that a command starts, or null when there is none now. Throws for a command text that is
 * not an accepted form, so the form can say what is wrong rather than "not found".
 */
export const resolveAgentCommand = Effect.fn("AcpAgentCommand.resolve")(function* (
  command: string,
  options: ResolveAgentCommandOptions = {},
) {
  const platform = options.platform ?? process.platform;
  const form = agentCommandForm(command, platform);
  if (!form) return yield* providerFailure(new Error(sourceText("error.provider.customAgentCommandInvalid")));
  if (form === "path") return (yield* isExecutableFile(command, platform)) ? command : null;
  if (form === "home") {
    const path = join(options.home ?? homedir(), command.slice(2));
    return (yield* isExecutableFile(path, platform)) ? path : null;
  }
  if (platform === "win32" && !options.searchPath) return yield* whereExe(command);
  const folders = options.searchPath ?? (yield* searchPath());
  for (const folder of folders) {
    if (!isAbsolute(folder)) continue;
    const candidate = join(folder, command);
    if (yield* isExecutableFile(candidate, platform)) return candidate;
  }
  return null;
});

let loginPath: { value: Deferred.Deferred<readonly string[]>; readAt: number } | null = null;

/**
 * The login shell's `PATH`, then this process's. The script is fixed: no user text reaches the
 * shell. A packaged app starts with a short `PATH`, and a version manager adds its folders in the
 * profile that only a login shell reads.
 */
const searchPath = Effect.fn("AcpAgentCommand.searchPath")(function* () {
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

const whereExe = Effect.fn("AcpAgentCommand.whereExe")((command: string) =>
  providerCall(() => execFileAsync("where.exe", [command], { timeout: 5_000, maxBuffer: 64 * 1024 })).pipe(
    Effect.map(({ stdout }) => pickWindowsExecutable(stdout, process.env.PATHEXT)),
    Effect.catch(() => Effect.succeed(null)),
  ),
);

const isExecutableFile = Effect.fn("AcpAgentCommand.isExecutableFile")(
  function* (path: string, platform: NodeJS.Platform) {
    if (!(yield* providerCall(() => stat(path))).isFile()) return false;
    yield* providerCall(() => access(path, platform === "win32" ? constants.F_OK : constants.X_OK));
    return true;
  },
  Effect.catch(() => Effect.succeed(false)),
);
