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

export interface LoginItem {
  read: () => Effect.Effect<boolean, LoginItemFailure>;
  write: (enabled: boolean) => Effect.Effect<void, LoginItemFailure>;
  refresh: () => Effect.Effect<void, LoginItemFailure>;
}

export function createLoginItem(options: { appVariant: AppVariant; server: boolean }): LoginItem | null {
  if (!app.isPackaged || options.server) return null;
  if (process.platform !== "linux") return electronLoginItem();
  const configHome = process.env.XDG_CONFIG_HOME;
  return linuxAutostartLoginItem({
    configHome: configHome && isAbsolute(configHome) ? configHome : join(homedir(), ".config"),
    fileName: options.appVariant === "production" ? "openbot.desktop" : `openbot-${options.appVariant}.desktop`,
    executablePath: process.env.APPIMAGE || process.execPath,
  });
}

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
    refresh: () => Effect.void,
  };
}

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

function desktopEntryExec(executablePath: string): string {
  if (/[\n\r]/.test(executablePath)) throw new Error("The executable path contains a line break.");
  const quoted = `"${executablePath.replace(/["`$\\]/g, (character) => `\\${character}`)}"`;
  return quoted.replace(/\\/g, "\\\\").replace(/%/g, "%%");
}
