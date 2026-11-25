import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { join, win32 } from "node:path";
import { promisify } from "node:util";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect } from "effect";
import { sharedWindowsLookup } from "./cli";
import { piAgentDirectory } from "./process-confinement";

const execFileAsync = promisify(execFile);
const logger = createOpenBotLogger("provider-runtime");

const WSL_LAUNCHER_FOLDERS = new Set(["system32", "sysnative", "windowsapps"]);

const WSL_CHECK_TIMEOUT_MS = 15_000;

const BROKEN_LAUNCHER_REUSE_MS = 60_000;

const workingLaunchers = new Set<string>();
const brokenLaunchers = new Map<string, number>();

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

const piBashPath = Effect.fn("PiWindowsShell.bashPath")(function* (cwd: string, environment: Record<string, string>) {
  for (const name of ["ProgramFiles", "ProgramFiles(x86)"]) {
    const root = variable(environment, name);
    if (!root) continue;
    const gitBash = `${root}\\Git\\bin\\bash.exe`;
    if (yield* exists(gitBash)) return gitBash;
  }
  const where = win32.join(variable(environment, "SystemRoot") ?? "C:\\Windows", "System32", "where.exe");
  const key = ["pi-bash", where, cwd, variable(environment, "PATH") ?? "", variable(environment, "PATHEXT") ?? ""].join(
    "\u0000",
  );
  const found = yield* Effect.tryPromise(() =>
    sharedWindowsLookup(key, () =>
      execFileAsync(where, ["bash.exe"], { cwd, env: environment, timeout: 5_000, windowsHide: true }).then(
        ({ stdout }) => stdout,
      ),
    ),
  ).pipe(
    Effect.map((stdout) => stdout.trim().split(/\r?\n/u)[0]?.trim() ?? ""),
    Effect.orElseSucceed(() => ""),
  );
  return found && (yield* exists(found)) ? found : null;
});

function isWslLauncher(path: string): boolean {
  return WSL_LAUNCHER_FOLDERS.has(win32.basename(win32.dirname(path)).toLowerCase());
}

const launcherRuns = Effect.fn("PiWindowsShell.launcherRuns")(function* (
  bash: string,
  cwd: string,
  environment: Record<string, string>,
) {
  if (workingLaunchers.has(bash)) return true;
  const brokenAt = brokenLaunchers.get(bash);
  if (brokenAt !== undefined && Date.now() - brokenAt < BROKEN_LAUNCHER_REUSE_MS) return false;
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
    Effect.catch((cause) => {
      const timedOut = isDynamicRecord(cause) && cause.killed === true;
      if (!timedOut) brokenLaunchers.set(bash, Date.now());
      return Effect.succeed(timedOut);
    }),
  );
});

function exists(path: string) {
  return Effect.tryPromise(() => access(path)).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  );
}

function variable(environment: Record<string, string>, name: string): string | undefined {
  const key = Object.keys(environment).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : environment[key];
}
