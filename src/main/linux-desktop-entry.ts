import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";

const logger = createOpenBotLogger("linux-desktop-entry");

/**
 * The file name has to stay `openbot.desktop`: it is `desktopName` in package.json, which is what
 * Electron uses as the application id it hands to `xdg-settings`, and what electron-builder writes
 * into `StartupWMClass` so a window groups with this entry.
 */
const DESKTOP_FILE_NAME = "openbot.desktop";
const WM_CLASS = "openbot";

/**
 * The desktop entry that makes an `openbot://` link reach the app.
 *
 * `Exec` names the AppImage itself, because that is the only path that survives a restart, and `%U`
 * is what passes the invitation URL to it.
 */
export function linuxDesktopEntry(appImagePath: string, iconPath: string): string {
  return `${[
    "[Desktop Entry]",
    "Type=Application",
    "Name=OpenBot",
    "Comment=A local-first multi-agent desktop workspace.",
    `Exec=${quoteExecutable(appImagePath)} %U`,
    `Icon=${iconPath}`,
    "Terminal=false",
    "Categories=Development;",
    `StartupWMClass=${WM_CLASS}`,
    "MimeType=x-scheme-handler/openbot;",
  ].join("\n")}\n`;
}

/**
 * Writes the desktop entry for an AppImage, and reports the path it wrote, or `null` when there was
 * nothing to write.
 *
 * `app.setAsDefaultProtocolClient` calls `xdg-settings` on Linux, and `xdg-settings` can only name a
 * desktop entry that already exists. A downloaded AppImage has none, so without this the scheme
 * registration silently does nothing and every invitation link fails. Any other Linux build was
 * installed by a package manager, which owns the entry; this leaves that one alone.
 */
export async function installLinuxDesktopEntry(options: {
  platform: NodeJS.Platform;
  environment: NodeJS.ProcessEnv;
  iconPath: string;
  homeDirectory?: string;
}): Promise<string | null> {
  if (options.platform !== "linux") return null;
  const appImagePath = options.environment.APPIMAGE?.trim();
  if (!appImagePath) return null;
  const dataHome = options.environment.XDG_DATA_HOME?.trim();
  const directory = join(dataHome || join(options.homeDirectory ?? homedir(), ".local", "share"), "applications");
  const path = join(directory, DESKTOP_FILE_NAME);
  const entry = linuxDesktopEntry(appImagePath, options.iconPath);
  try {
    if ((await readEntry(path)) === entry) return path;
    await mkdir(directory, { recursive: true });
    await writeFile(path, entry, { mode: 0o644 });
    logger.info(`Installed the desktop entry at ${path}.`);
    return path;
  } catch (error) {
    logger.warn("Unable to install the desktop entry, so openbot:// links stay unregistered.", toLogValue(error));
    return null;
  }
}

async function readEntry(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * Quotes a path for the `Exec` key. The desktop entry specification reserves a set of characters
 * inside a quoted argument, and a backslash is what escapes them.
 */
function quoteExecutable(path: string): string {
  return `"${path.replace(/(["`$\\])/gu, "\\$1")}"`;
}
