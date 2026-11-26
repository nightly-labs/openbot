import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, isAbsolute, join } from "node:path";
import { CUSTOM_AGENT_LIMITS } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { loginSearchPath, windowsWhere } from "./cli";
import { pickWindowsExecutable } from "./mcp-provider-shapes";
import { providerCall, providerFailure } from "./provider-client-effects";

const AGENT_COMMAND_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;

const WINDOWS_SCRIPT_ARG_PATTERN = /^[A-Za-z0-9_.,:=@+/\\-]+$/;

export type AgentCommandForm = "path" | "home" | "name";

export function agentCommandForm(
  command: string,
  platform: NodeJS.Platform = process.platform,
): AgentCommandForm | null {
  if (command.length === 0 || command.length > CUSTOM_AGENT_LIMITS.command) return null;
  if (/[\0\r\n]/.test(command) || command !== command.trim()) return null;
  if (command.startsWith("~/")) return "home";
  if (isAbsolute(command) || (platform === "win32" && /^[A-Za-z]:[\\/]/.test(command))) return "path";
  return AGENT_COMMAND_NAME_PATTERN.test(command) ? "name" : null;
}

export function assertAgentArgs(args: readonly string[]): void {
  if (args.length > CUSTOM_AGENT_LIMITS.args) throw new Error(sourceText("error.provider.customAgentArgsInvalid"));
  for (const arg of args) {
    if (arg.length > CUSTOM_AGENT_LIMITS.arg || /[\0\r\n]/.test(arg)) {
      throw new Error(sourceText("error.provider.customAgentArgsInvalid"));
    }
  }
}

export function assertWindowsScriptArgs(
  executable: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform !== "win32" || ![".cmd", ".bat"].includes(extname(executable).toLowerCase())) return;
  if (executable.includes('"') || args.some((arg) => !WINDOWS_SCRIPT_ARG_PATTERN.test(arg))) {
    throw new Error(sourceText("error.provider.customAgentWindowsScript"));
  }
}

export interface ResolveAgentCommandOptions {
  platform?: NodeJS.Platform;
  home?: string;
  searchPath?: readonly string[];
}

export const resolveAgentCommand = Effect.fn("AcpAgentCommand.resolve")(function* (
  command: string,
  options: ResolveAgentCommandOptions = {},
) {
  const platform = options.platform ?? process.platform;
  const form = agentCommandForm(command, platform);
  if (!form) return yield* providerFailure(new Error(sourceText("error.provider.customAgentCommandInvalid")));
  if (form === "path") return (yield* isExecutableFile(command, platform)) ? command : null;
  if (form === "home") {
    const path = join(options.home ?? homedir(), command.slice(2));
    return (yield* isExecutableFile(path, platform)) ? path : null;
  }
  if (platform === "win32" && !options.searchPath) return yield* whereExe(command);
  const folders = options.searchPath ?? (yield* loginSearchPath());
  for (const folder of folders) {
    if (!isAbsolute(folder)) continue;
    const candidate = join(folder, command);
    if (yield* isExecutableFile(candidate, platform)) return candidate;
  }
  return null;
});

const whereExe = Effect.fn("AcpAgentCommand.whereExe")((command: string) =>
  providerCall(() => windowsWhere(command, null)).pipe(
    Effect.map((stdout) => pickWindowsExecutable(stdout, process.env.PATHEXT)),
    Effect.catch(() => Effect.succeed(null)),
  ),
);

const isExecutableFile = Effect.fn("AcpAgentCommand.isExecutableFile")(
  function* (path: string, platform: NodeJS.Platform) {
    if (!(yield* providerCall(() => stat(path))).isFile()) return false;
    yield* providerCall(() => access(path, platform === "win32" ? constants.F_OK : constants.X_OK));
    return true;
  },
  Effect.catch(() => Effect.succeed(false)),
);
