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
const ICON_FILE_NAME = "openbot.png";
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
  const dataDirectory = dataHome || join(options.homeDirectory ?? homedir(), ".local", "share");
  const directory = join(dataDirectory, "applications");
  const path = join(directory, DESKTOP_FILE_NAME);
  const entry = linuxDesktopEntry(appImagePath, await installIcon(dataDirectory, options.iconPath));
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

/**
 * Copies the launcher icon to a path that outlives the process, and reports the path the entry has
 * to name. Reports the packaged path instead when the copy fails, because an entry with an icon
 * that can disappear is still better than no invitation links at all.
 *
 * An AppImage mounts its resources in a temporary directory that the runtime removes when the app
 * exits, so an entry that points there loses its icon as soon as OpenBot is not running. The entry
 * names the copy by absolute path, which the desktop entry specification allows, rather than by
 * icon theme name: one loose file under the data home is not a theme.
 */
async function installIcon(dataDirectory: string, iconPath: string): Promise<string> {
  const directory = join(dataDirectory, "icons");
  const path = join(directory, ICON_FILE_NAME);
  try {
    const icon = await readFile(iconPath);
    if (icon.equals(await readIcon(path))) return path;
    await mkdir(directory, { recursive: true });
    await writeFile(path, icon, { mode: 0o644 });
    logger.info(`Installed the launcher icon at ${path}.`);
    return path;
  } catch (error) {
    logger.warn("Unable to install the launcher icon, so the entry names the packaged one.", toLogValue(error));
    return iconPath;
  }
}

async function readIcon(path: string): Promise<Buffer> {
  try {
    return await readFile(path);
  } catch {
    return Buffer.alloc(0);
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
