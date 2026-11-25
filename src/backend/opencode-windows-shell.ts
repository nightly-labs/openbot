import { lstatSync, statSync } from "node:fs";
import { win32 } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect } from "effect";

const logger = createOpenBotLogger("provider-runtime");

const DEFAULT_PATH_EXTENSIONS = ".COM;.EXE;.BAT;.CMD";

export function openCodeWindowsShellEnv(
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  if (platform !== "win32" || variable(environment, "SHELL")?.trim()) return {};
  const folders = (variable(environment, "PATH") ?? "")
    .split(win32.delimiter)
    .map((folder) => folder.trim().replace(/^"(.*)"$/u, "$1"))
    .filter(Boolean);
  const extensions = (variable(environment, "PATHEXT") || DEFAULT_PATH_EXTENSIONS).split(";").filter(Boolean);
  if (folders.some((folder) => extensions.some((extension) => isFile(win32.join(folder, `pwsh${extension}`)))))
    return {};
  if (!folders.some(isStorePowerShellAlias)) return {};
  const windowsPowerShell = win32.join(
    variable(environment, "SystemRoot") || "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  if (!isFile(windowsPowerShell)) return {};
  logger.info("OpenCode gets Windows PowerShell, because PowerShell 7 is only the Microsoft Store alias.");
  return { SHELL: windowsPowerShell };
}

function isStorePowerShellAlias(folder: string): boolean {
  if (win32.basename(folder).toLowerCase() !== "windowsapps") return false;
  return Effect.runSync(
    Effect.try(() => lstatSync(win32.join(folder, "pwsh.exe"), { throwIfNoEntry: false }) !== undefined).pipe(
      Effect.orElseSucceed(() => false),
    ),
  );
}

function isFile(path: string): boolean {
  return Effect.runSync(
    Effect.try(() => statSync(path, { throwIfNoEntry: false })?.isFile() === true).pipe(
      Effect.orElseSucceed(() => false),
    ),
  );
}

function variable(environment: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = Object.keys(environment).findLast((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : environment[key];
}
