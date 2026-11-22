import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect, Schema } from "effect";
import { causeHelpers } from "../backend/effect-boundary";

const logger = createOpenBotLogger("linux-desktop-entry");

const DESKTOP_FILE_NAME = "openbot.desktop";
const ICON_FILE_NAME = "openbot.png";
const WM_CLASS = "openbot";
const LAUNCHER_READ_CONCURRENCY = 16;
const GSETTINGS_TIMEOUT_MS = 2_000;
const execFileAsync = promisify(execFile);

function linuxDesktopEntry(appImagePath: string, iconPath: string, ownsWindow: boolean): string {
  return `${[
    "[Desktop Entry]",
    "Type=Application",
    "Name=OpenBot",
    "Comment=A local-first multi-agent desktop workspace.",
    `Exec=${quoteExecutable(appImagePath)} %U`,
    `Icon=${iconPath}`,
    "Terminal=false",
    ...(ownsWindow ? ["Categories=Development;", `StartupWMClass=${WM_CLASS}`] : ["NoDisplay=true"]),
    "MimeType=x-scheme-handler/openbot;",
  ].join("\n")}\n`;
}

function desktopEntryKeys(entry: string): Map<string, string> {
  const keys = new Map<string, string>();
  let inMainGroup = false;
  for (const line of entry.split(/\r?\n/u)) {
    if (line.startsWith("[")) inMainGroup = line.trim() === "[Desktop Entry]";
    const separator = line.indexOf("=");
    if (inMainGroup && separator > 0 && !keys.has(line.slice(0, separator).trim()))
      keys.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return keys;
}

function execProgram(exec: string): string {
  const quoted = /^"((?:[^"\\]|\\.)*)"/u.exec(exec);
  if (quoted) return (quoted[1] ?? "").replace(/\\(.)/gu, "$1");
  return exec.split(/\s/u)[0] ?? "";
}

function programsOfVisibleLauncherWithOurWindow(entry: string): string[] {
  const keys = desktopEntryKeys(entry);
  if (keys.get("StartupWMClass") !== WM_CLASS) return [];
  if (keys.get("NoDisplay") === "true" || keys.get("Hidden") === "true") return [];
  return [keys.get("TryExec") ?? "", execProgram(keys.get("Exec") ?? "")].filter((program) => program !== "");
}

function resolvedPath(path: string): Effect.Effect<string> {
  return desktopEntryIO(() => realpath(path)).pipe(Effect.catch(() => Effect.succeed(path)));
}

const otherLauncherStartsAppImage = Effect.fn("LinuxDesktopEntry.otherLauncherStartsAppImage")(function* (
  directory: string,
  appImagePath: string,
) {
  const names = yield* desktopEntryIO(() => readdir(directory)).pipe(Effect.catch(() => Effect.succeed<string[]>([])));
  const appImage = yield* resolvedPath(appImagePath);
  const matches = yield* Effect.forEach(
    names.filter((name) => name.endsWith(".desktop") && name !== DESKTOP_FILE_NAME),
    (name) =>
      Effect.gen(function* () {
        const entry = yield* readEntry(join(directory, name));
        for (const program of entry === null ? [] : programsOfVisibleLauncherWithOurWindow(entry)) {
          if (program === appImagePath || (yield* resolvedPath(program)) === appImage) return true;
        }
        return false;
      }),
    { concurrency: LAUNCHER_READ_CONCURRENCY },
  );
  return matches.includes(true);
});

function runsGnomeShell(environment: NodeJS.ProcessEnv): boolean {
  return (environment.XDG_CURRENT_DESKTOP ?? "").split(":").some((desktop) => desktop.trim().toUpperCase() === "GNOME");
}

const gnomeFavoritesLeaveOutOurLauncher = Effect.fn("LinuxDesktopEntry.gnomeFavoritesLeaveOutOurLauncher")(function* (
  environment: NodeJS.ProcessEnv,
) {
  if (!runsGnomeShell(environment)) return false;
  return yield* desktopEntryIO(() =>
    execFileAsync("gsettings", ["get", "org.gnome.shell", "favorite-apps"], {
      encoding: "utf8",
      timeout: GSETTINGS_TIMEOUT_MS,
    }),
  ).pipe(
    Effect.map(({ stdout }) => stdout.trim().startsWith("[") && !stdout.includes(`'${DESKTOP_FILE_NAME}'`)),
    Effect.catch(() => Effect.succeed(false)),
  );
});

const anotherLauncherShouldOwnWindow = Effect.fn("LinuxDesktopEntry.anotherLauncherShouldOwnWindow")(function* (
  directory: string,
  appImagePath: string,
  environment: NodeJS.ProcessEnv,
) {
  if (!(yield* otherLauncherStartsAppImage(directory, appImagePath))) return false;
  return yield* gnomeFavoritesLeaveOutOurLauncher(environment);
});

interface DesktopEntryOptions {
  platform: NodeJS.Platform;
  environment: NodeJS.ProcessEnv;
  iconPath: string;
  homeDirectory?: string;
}

export const installLinuxDesktopEntry = Effect.fn("LinuxDesktopEntry.install")(function* (
  options: DesktopEntryOptions,
) {
  if (options.platform !== "linux") return null;
  const appImagePath = options.environment.APPIMAGE?.trim();
  if (!appImagePath) return null;
  const dataHome = options.environment.XDG_DATA_HOME?.trim();
  const dataDirectory = dataHome || join(options.homeDirectory ?? homedir(), ".local", "share");
  const directory = join(dataDirectory, "applications");
  const path = join(directory, DESKTOP_FILE_NAME);
  const iconPath = yield* installIcon(dataDirectory, options.iconPath);
  const ownsWindow = !(yield* anotherLauncherShouldOwnWindow(directory, appImagePath, options.environment));
  const entry = linuxDesktopEntry(appImagePath, iconPath, ownsWindow);
  const result = yield* Effect.result(
    Effect.gen(function* () {
      if ((yield* readEntry(path)) === entry) return path;
      yield* desktopEntryIO(() => mkdir(directory, { recursive: true }));
      yield* desktopEntryIO(() => writeFile(path, entry, { mode: 0o644 }));
      logger.info(
        ownsWindow
          ? `Installed the desktop entry at ${path}.`
          : `Installed a hidden desktop entry at ${path}, because another launcher starts this AppImage and the dock does not pin this entry.`,
      );
      return path;
    }),
  );
  if (result._tag === "Success") return result.success;
  logger.warn(
    "Unable to install the desktop entry, so openbot:// links stay unregistered.",
    toLogValue(result.failure.cause),
  );
  return null;
});

const installIcon = Effect.fn("LinuxDesktopEntry.installIcon")(function* (dataDirectory: string, iconPath: string) {
  const directory = join(dataDirectory, "icons");
  const path = join(directory, ICON_FILE_NAME);
  const result = yield* Effect.result(
    Effect.gen(function* () {
      const icon = yield* desktopEntryIO(() => readFile(iconPath));
      if (icon.equals(yield* readIcon(path))) return path;
      yield* desktopEntryIO(() => mkdir(directory, { recursive: true }));
      yield* desktopEntryIO(() => writeFile(path, icon, { mode: 0o644 }));
      logger.info(`Installed the launcher icon at ${path}.`);
      return path;
    }),
  );
  if (result._tag === "Success") return result.success;
  logger.warn(
    "Unable to install the launcher icon, so the entry names the packaged one.",
    toLogValue(result.failure.cause),
  );
  return iconPath;
});

function readIcon(path: string): Effect.Effect<Buffer> {
  return desktopEntryIO(() => readFile(path)).pipe(Effect.catch(() => Effect.sync(() => Buffer.alloc(0))));
}

function readEntry(path: string): Effect.Effect<string | null> {
  return desktopEntryIO(() => readFile(path, "utf8")).pipe(Effect.catch(() => Effect.succeed(null)));
}

class DesktopEntryFailure extends Schema.TaggedError<DesktopEntryFailure>()("DesktopEntryFailure", {
  cause: Schema.Defect(),
}) {}

const { io: desktopEntryIO } = causeHelpers(DesktopEntryFailure);

function quoteExecutable(path: string): string {
  return `"${path.replace(/(["`$\\])/gu, "\\$1")}"`;
}
