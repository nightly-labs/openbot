import { lstatSync, statSync } from "node:fs";
import { win32 } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";

const logger = createOpenBotLogger("provider-runtime");

const DEFAULT_PATH_EXTENSIONS = ".COM;.EXE;.BAT;.CMD";

let reported = false;

export function openCodeWindowsShellEnv(
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  if (platform !== "win32" || variable(environment, "SHELL")?.trim()) return {};
  const folders = (variable(environment, "PATH") ?? "")
    .split(win32.delimiter)
    .map((folder) => folder.trim().replace(/^"(.*)"$/u, "$1"))
    .filter(Boolean);
  const storeFolders = folders.filter(isWindowsAppsFolder);
  if (!storeFolders.some(hasPowerShellAlias)) return {};
  const extensions = (variable(environment, "PATHEXT") || DEFAULT_PATH_EXTENSIONS).split(";").filter(Boolean);
  const installedFolders = folders.filter((folder) => !isWindowsAppsFolder(folder));
  if (installedFolders.some((folder) => extensions.some((extension) => isFile(win32.join(folder, `pwsh${extension}`)))))
    return {};
  const windowsPowerShell = win32.join(
    variable(environment, "SystemRoot") || "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  if (!isFile(windowsPowerShell)) return {};
  if (!reported)
    logger.info("OpenCode gets Windows PowerShell, because PowerShell 7 is only the Microsoft Store alias.");
  reported = true;
  return { SHELL: windowsPowerShell };
}

function isWindowsAppsFolder(folder: string): boolean {
  return win32.basename(folder).toLowerCase() === "windowsapps";
}

function hasPowerShellAlias(folder: string): boolean {
  try {
    return lstatSync(win32.join(folder, "pwsh.exe"), { throwIfNoEntry: false }) !== undefined;
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path, { throwIfNoEntry: false })?.isFile() === true;
  } catch {
    return false;
  }
}

function variable(environment: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = Object.keys(environment).findLast((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : environment[key];
}
