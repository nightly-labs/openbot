import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect, Schema } from "effect";
import { causeHelpers } from "../backend/effect-boundary";

const logger = createOpenBotLogger("linux-desktop-entry");

const DESKTOP_FILE_NAME = "openbot.desktop";
const ICON_FILE_NAME = "openbot.png";
const WM_CLASS = "openbot";

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

function launchesAppImageWithOurWindow(entry: string, appImagePath: string): boolean {
  const keys = desktopEntryKeys(entry);
  if (keys.get("StartupWMClass") !== WM_CLASS) return false;
  if (keys.get("NoDisplay") === "true" || keys.get("Hidden") === "true") return false;
  return keys.get("TryExec") === appImagePath || execProgram(keys.get("Exec") ?? "") === appImagePath;
}

const otherLauncherOwnsWindow = Effect.fn("LinuxDesktopEntry.otherLauncherOwnsWindow")(function* (
  directory: string,
  appImagePath: string,
) {
  const names = yield* desktopEntryIO(() => readdir(directory)).pipe(Effect.catch(() => Effect.succeed<string[]>([])));
  for (const name of names) {
    if (!name.endsWith(".desktop") || name === DESKTOP_FILE_NAME) continue;
    const entry = yield* readEntry(join(directory, name));
    if (entry !== null && launchesAppImageWithOurWindow(entry, appImagePath)) return true;
  }
  return false;
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
  const ownsWindow = !(yield* otherLauncherOwnsWindow(directory, appImagePath));
  const entry = linuxDesktopEntry(appImagePath, iconPath, ownsWindow);
  const result = yield* Effect.result(
    Effect.gen(function* () {
      if ((yield* readEntry(path)) === entry) return path;
      yield* desktopEntryIO(() => mkdir(directory, { recursive: true }));
      yield* desktopEntryIO(() => writeFile(path, entry, { mode: 0o644 }));
      logger.info(
        ownsWindow
          ? `Installed the desktop entry at ${path}.`
          : `Installed a hidden desktop entry at ${path}, because another launcher starts this AppImage.`,
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
