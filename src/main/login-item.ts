import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { AppVariant } from "@openbot/contracts/ipc";
import { Effect, Schema } from "effect";
import { app } from "electron";
import { writeFileAtomically } from "../backend/atomic-json-file";
import { isMissingFileError } from "../backend/file-errors";

export class LoginItemFailure extends Schema.TaggedError<LoginItemFailure>()("LoginItemFailure", {
  cause: Schema.Defect(),
}) {}

/** Whether the operating system opens OpenBot when the user signs in. The system holds the value. */
export interface LoginItem {
  read: () => Effect.Effect<boolean, LoginItemFailure>;
  write: (enabled: boolean) => Effect.Effect<void, LoginItemFailure>;
  /** Points an existing item at the running copy of OpenBot. Called once at start. */
  refresh: () => Effect.Effect<void, LoginItemFailure>;
}

/**
 * Null where OpenBot must not open itself at login: a development run would register the Electron
 * binary with no app, and a server starts from its own service unit.
 */
export function createLoginItem(options: { appVariant: AppVariant; server: boolean }): LoginItem | null {
  if (!app.isPackaged || options.server) return null;
  if (process.platform !== "linux") return electronLoginItem();
  const configHome = process.env.XDG_CONFIG_HOME;
  return linuxAutostartLoginItem({
    // The XDG Base Directory Specification ignores a relative path.
    configHome: configHome && isAbsolute(configHome) ? configHome : join(homedir(), ".config"),
    fileName: options.appVariant === "production" ? "openbot.desktop" : `openbot-${options.appVariant}.desktop`,
    // The AppImage runtime names its own file here. `execPath` is inside the mount, which ends with the run.
    executablePath: process.env.APPIMAGE || process.execPath,
  });
}

/**
 * macOS and Windows register the running executable through Electron. The user can turn the item
 * off in the system settings, so each read asks the system again. On Windows only
 * `executableWillLaunchAtLogin` includes the switch in Task Manager; a write sets it again.
 */
function electronLoginItem(): LoginItem {
  return {
    read: () =>
      Effect.try({
        try: () => {
          const settings = app.getLoginItemSettings();
          return process.platform === "win32" ? settings.executableWillLaunchAtLogin : settings.openAtLogin;
        },
        catch: (cause) => new LoginItemFailure({ cause }),
      }),
    write: (enabled) =>
      Effect.try({
        try: () => app.setLoginItemSettings({ openAtLogin: enabled }),
        catch: (cause) => new LoginItemFailure({ cause }),
      }),
    // The item names the executable, and an update keeps its path.
    refresh: () => Effect.void,
  };
}

/**
 * Linux has no Electron login item. The desktop opens each entry in the XDG autostart directory at
 * sign-in, so the file is the switch. A desktop settings app can turn the entry off in place, with
 * `Hidden=true` or, on GNOME, `X-GNOME-Autostart-enabled=false`; such an entry reads as off.
 *
 * An update of the AppImage can give it a new file name, so `refresh` writes the entry again with
 * the path of the running copy.
 */
function linuxAutostartLoginItem(options: { configHome: string; fileName: string; executablePath: string }): LoginItem {
  const path = join(options.configHome, "autostart", options.fileName);
  const read = () =>
    Effect.tryPromise({
      try: () =>
        readFile(path, "utf8").then(isEnabledAutostartEntry, (error: unknown) => {
          if (isMissingFileError(error)) return false;
          throw error;
        }),
      catch: (cause) => new LoginItemFailure({ cause }),
    });
  const create = () =>
    Effect.try({
      try: () => autostartEntry(options.executablePath),
      catch: (cause) => new LoginItemFailure({ cause }),
    }).pipe(
      Effect.flatMap((entry) =>
        writeFileAtomically(path, entry, { createDirectory: true }).pipe(
          Effect.mapError(({ cause }) => new LoginItemFailure({ cause })),
        ),
      ),
    );
  const remove = () =>
    Effect.tryPromise({
      try: () => rm(path, { force: true }),
      catch: (cause) => new LoginItemFailure({ cause }),
    });
  return {
    read,
    write: (enabled) => (enabled ? create() : remove()),
    refresh: () => Effect.flatMap(read(), (enabled) => (enabled ? create() : Effect.void)),
  };
}

/** Reads only the `[Desktop Entry]` group, where the XDG Autostart Specification puts both keys. */
function isEnabledAutostartEntry(contents: string): boolean {
  let group = "";
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) group = trimmed;
    else if (group === "[Desktop Entry]") {
      const [key, value] = trimmed.split("=", 2).map((part) => part.trim());
      if ((key === "Hidden" && value === "true") || (key === "X-GNOME-Autostart-enabled" && value === "false"))
        return false;
    }
  }
  return true;
}

function autostartEntry(executablePath: string): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    `Name=${app.name}`,
    `Exec=${desktopEntryExec(executablePath)}`,
    "Terminal=false",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");
}

/**
 * The Desktop Entry Specification quotes `"`, `` ` ``, `$` and `\` in a quoted argument, and then
 * escapes each backslash again as a string value. A literal `%` is `%%`.
 */
function desktopEntryExec(executablePath: string): string {
  if (/[\n\r]/.test(executablePath)) throw new Error("The executable path contains a line break.");
  const quoted = `"${executablePath.replace(/["`$\\]/g, (character) => `\\${character}`)}"`;
  return quoted.replace(/\\/g, "\\\\").replace(/%/g, "%%");
}
