import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { join, win32 } from "node:path";
import { promisify } from "node:util";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect } from "effect";
import { piAgentDirectory } from "./process-confinement";

const execFileAsync = promisify(execFile);
const logger = createOpenBotLogger("provider-runtime");

/** The folders where Windows puts the WSL launcher `bash.exe`, which is not a shell of its own. */
const WSL_LAUNCHER_FOLDERS = new Set(["system32", "sysnative", "windowsapps"]);

/** The first command of a WSL that is not running also starts its Linux, which can take seconds. */
const WSL_CHECK_TIMEOUT_MS = 15_000;

/** WSL launchers that ran a command. A Linux that WSL runs seldom goes away, so each is checked once. */
const workingLaunchers = new Set<string>();

/**
 * The `--tools` arguments that give Pi on Windows a shell that runs commands (#11209).
 *
 * Pi's `bash` tool uses the `shellPath` of its settings, else Git Bash from Program Files, else the first
 * `bash.exe` on PATH (`getShellConfig`,
 * the same from Pi 1.1.0 to 1.5.2). Without Git for Windows, that is the WSL launcher in System32. It
 * fails each command when WSL has no Linux, and with no `bash.exe` at all Pi fails each command too.
 * Pi then gets its `powershell` tool in place of `bash`. Git Bash, another bash, and a WSL with a Linux
 * that runs keep `bash`. The `+` and `-` entries keep the tools that the user set in Pi's settings.
 * Call it only on Windows.
 */
export const piWindowsShellArguments = Effect.fn("PiWindowsShell.arguments")(function* (
  cwd: string,
  environment: Record<string, string>,
) {
  if (yield* hasShellSetting(cwd, environment)) return [];
  const bash = yield* piBashPath(cwd, environment);
  if (bash && (!isWslLauncher(bash) || (yield* launcherRuns(bash, cwd, environment)))) return [];
  logger.info("Pi has no bash that runs commands, so it uses PowerShell.", { wslLauncher: bash !== null });
  return ["--tools", "-bash,+powershell"];
});

/** Whether Pi's user or project settings name the shell (`shellPath`), which Pi uses before it looks. */
const hasShellSetting = Effect.fn("PiWindowsShell.hasShellSetting")(function* (
  cwd: string,
  environment: Record<string, string>,
) {
  for (const file of [join(piAgentDirectory(environment), "settings.json"), join(cwd, ".pi", "settings.json")]) {
    const settings = yield* Effect.tryPromise(() => readFile(file, "utf8")).pipe(
      Effect.flatMap((text) => Effect.try((): unknown => JSON.parse(text))),
      Effect.orElseSucceed(() => null),
    );
    if (isDynamicRecord(settings) && typeof settings.shellPath === "string" && settings.shellPath.trim()) return true;
  }
  return false;
});

/** The `bash.exe` that Pi runs, found in Pi's order, or null when it finds none. */
const piBashPath = Effect.fn("PiWindowsShell.bashPath")(function* (cwd: string, environment: Record<string, string>) {
  for (const name of ["ProgramFiles", "ProgramFiles(x86)"]) {
    const root = variable(environment, name);
    if (!root) continue;
    const gitBash = `${root}\\Git\\bin\\bash.exe`;
    if (yield* exists(gitBash)) return gitBash;
  }
  // Pi takes the first answer of `where`, which also looks in the folder that Pi runs in. The full path
  // keeps a `where.exe` in that folder from running: Windows looks in the current folder first.
  const where = win32.join(variable(environment, "SystemRoot") ?? "C:\\Windows", "System32", "where.exe");
  const found = yield* Effect.tryPromise((signal) =>
    execFileAsync(where, ["bash.exe"], { cwd, env: environment, signal, timeout: 5_000, windowsHide: true }),
  ).pipe(
    Effect.map(({ stdout }) => stdout.trim().split(/\r?\n/u)[0]?.trim() ?? ""),
    Effect.orElseSucceed(() => ""),
  );
  return found && (yield* exists(found)) ? found : null;
});

function isWslLauncher(path: string): boolean {
  return WSL_LAUNCHER_FOLDERS.has(win32.basename(win32.dirname(path)).toLowerCase());
}

/**
 * Whether the WSL launcher runs a command. A check that does not end in time keeps `bash`, as before,
 * and the next thread checks again.
 */
const launcherRuns = Effect.fn("PiWindowsShell.launcherRuns")(function* (
  bash: string,
  cwd: string,
  environment: Record<string, string>,
) {
  if (workingLaunchers.has(bash)) return true;
  return yield* Effect.tryPromise({
    try: (signal) =>
      execFileAsync(bash, ["-c", "true"], {
        cwd,
        env: environment,
        signal,
        timeout: WSL_CHECK_TIMEOUT_MS,
        windowsHide: true,
      }),
    catch: (cause) => cause,
  }).pipe(
    Effect.tap(() => Effect.sync(() => workingLaunchers.add(bash))),
    Effect.as(true),
    Effect.catch((cause) => Effect.succeed(isDynamicRecord(cause) && cause.killed === true)),
  );
});

function exists(path: string) {
  // `access`, not `stat`: `stat` refuses the app aliases in WindowsApps, which Pi accepts.
  return Effect.tryPromise(() => access(path)).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  );
}

/** Windows names its variables without case. */
function variable(environment: Record<string, string>, name: string): string | undefined {
  const key = Object.keys(environment).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : environment[key];
}
