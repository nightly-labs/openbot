/**
 * Windows #11233: a Microsoft Store (MSIX) app, such as Claude Desktop, gives its package identity to
 * the processes that it starts. Windows then writes the files that such a process puts in %APPDATA%
 * to a private folder of that package (`%LOCALAPPDATA%\Packages\<package>\LocalCache\Roaming`). OpenBot
 * started from such an app kept its database and sign-in there, and a later start from the Start menu
 * found none of them. OpenBot is never an MSIX package, so a package identity always comes from the
 * app that started it. Electron sets `process.windowsStore` when the process has a package identity.
 *
 * The Windows shell (the explorer.exe that runs the desktop) starts OpenBot again outside the package.
 * A new explorer.exe gives a path or a link to the running shell and exits, as the start of a
 * non-elevated process from an elevated one does. The shell takes no arguments for a program, so only a
 * plain start or a start for one OpenBot link starts again.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect, Schema } from "effect";

const logger = createOpenBotLogger("main");

/** Set on the new start. When the shell could not take the start, the new process does not start again. */
const RESTART_MARKER = "OPENBOT_WINDOWS_PACKAGE_RESTART";

class WindowsPackageRestartFailure extends Schema.TaggedError<WindowsPackageRestartFailure>()(
  "WindowsPackageRestartFailure",
  { cause: Schema.Defect() },
) {}

/**
 * True when the Windows shell starts OpenBot again outside the package of the app that started this
 * process, and this process must exit. `isLink` tells an OpenBot link from other arguments.
 */
export const restartOutsideWindowsPackage = Effect.fn("restartOutsideWindowsPackage")(function* (
  environment: NodeJS.ProcessEnv,
  argv: readonly string[],
  isLink: (value: string) => boolean,
) {
  const restarted = environment[RESTART_MARKER] !== undefined;
  // Agents and later relaunches do not inherit the marker.
  delete environment[RESTART_MARKER];
  if (process.platform !== "win32" || !process.windowsStore) return false;
  if (restarted) {
    logger.warn("OpenBot still runs inside the package of the app that started it. Data goes to its folder.");
    return false;
  }
  const [link, ...rest] = argv.slice(1);
  if (rest.length > 0 || (link !== undefined && !isLink(link))) {
    logger.warn("OpenBot runs inside the package of the app that started it, with arguments the shell cannot take.");
    return false;
  }
  const target = link ?? process.execPath;
  const explorer = join(environment.SystemRoot ?? environment.windir ?? "C:\\Windows", "explorer.exe");
  return yield* Effect.callback<boolean, WindowsPackageRestartFailure>((resume) => {
    const child = spawn(explorer, [target], {
      detached: true,
      stdio: "ignore",
      env: { ...environment, [RESTART_MARKER]: "1" },
    });
    child.once("error", (cause) => resume(Effect.fail(new WindowsPackageRestartFailure({ cause }))));
    child.once("spawn", () => {
      child.unref();
      resume(Effect.succeed(true));
    });
  }).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        logger.warn("Could not start OpenBot outside the package of the app that started it:", toLogValue(error.cause));
        return false;
      }),
    ),
  );
});
