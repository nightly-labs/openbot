import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { isReservedMcpServerName, type McpServerConfig } from "@openbot/contracts/ipc";
import { loginShellCommand } from "./cli";

const execFileAsync = promisify(execFile);

/** Where a provider client reads the enabled configurations at spawn. */
export type McpServerSource = () => readonly McpServerConfig[];

/**
 * A configuration with its stdio command, directory and `PATH` resolved, or why it cannot start.
 *
 * `path` is both the `PATH` the command was looked up in and the one the server is launched with.
 * The two have to be the same: a lookup in another `PATH` answers for another build of the command.
 */
export type UsableMcpServer =
  | { config: McpServerConfig; command: string; workingDirectory: string; path: string | null; error?: undefined }
  | { config: McpServerConfig; command?: undefined; workingDirectory?: undefined; path?: undefined; error: string };

/**
 * The enabled configurations a provider can actually be given.
 *
 * Two jobs, both of which have to happen exactly once and before anything else reads the list:
 *
 * - A configuration that takes one of OpenBot's own bridge names is dropped. All four providers key
 *   MCP servers by name, so `openbot` here would displace the bridge the agent depends on.
 * - A stdio command is resolved to an absolute path. Claude and Codex spawn with no shell, so a bare
 *   `npx` fails in the provider even though a probe using the SDK's default environment succeeded.
 *   Resolving here, and probing the resolved value, keeps the panel's answer and the agent's answer
 *   the same. An unresolvable command is reported as failed rather than sent.
 */
export async function usableMcpServers(configs: readonly McpServerConfig[]): Promise<UsableMcpServer[]> {
  const candidates = configs.filter((config) => config.enabled && !isReservedMcpServerName(config.name));
  return Promise.all(candidates.map(usableMcpServer));
}

/**
 * One configuration made usable, whether or not it is enabled.
 *
 * A test answers for the configuration in front of the user, and a user may well test a server
 * before turning it on - so this one, unlike `usableMcpServers`, does not filter.
 */
export async function usableMcpServer(config: McpServerConfig): Promise<UsableMcpServer> {
  // An http server starts no process, so it needs neither a command nor a `PATH`.
  if (config.transport !== "stdio") return { config, command: "", workingDirectory: "", path: null };
  // A `PATH` the configuration carries is the one the server runs with, so it is the one the command
  // is looked up in: `python` with a virtual environment's `PATH` names that interpreter, and the
  // absolute path a login shell answered with would silently be a different one.
  const configured = mcpEnvironment(config).PATH;
  const path = configured ?? (await loginShellPath());
  const command = await resolveMcpCommand(config.command, path);
  if (!command) return { config, error: `Command not found: ${config.command}` };
  return { config, command, workingDirectory: resolveMcpWorkingDirectory(config.workingDirectory), path };
}

/**
 * The directory a stdio server starts in, with a leading `~` replaced by this user's home.
 *
 * The form offers `~/code` as its example, and a shell is what usually expands that: process
 * creation takes the value as written, so a literal `~` would be a directory that does not exist
 * and the spawn would fail. Expanding it here, once, keeps the probe and every provider on the same
 * directory. Anything else is passed through untouched, including a relative path, which a user
 * writes against the agent's own workspace.
 */
export function resolveMcpWorkingDirectory(value: string): string {
  const trimmed = value.trim();
  // A backslash separates only on Windows. On the other systems it is an ordinary character of a
  // file name, so `~\project` there names a directory called `~\project`.
  const homeRelative = process.platform === "win32" ? /^~[/\\]/u : /^~\//u;
  if (trimmed !== "~" && !homeRelative.test(trimmed)) return trimmed;
  const rest = trimmed.slice(2);
  return rest ? join(homedir(), rest) : homedir();
}

/**
 * One word for a POSIX shell, whatever it holds.
 *
 * The lookup below needs a shell, and the word it looks up is written by the user - and by a remote
 * administrator of this machine's host. Quoted, a name such as `node$(...)` is a name the machine
 * does not have; unquoted, the shell would run what is inside it while answering the question.
 */
function shellWord(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * An absolute path for a command name, or `null` when the given `PATH` holds none. A command the
 * user already wrote as a path is taken as written: it is their statement of which build to run.
 *
 * `path` is the list to search, which is the list the server will be launched with. Without one the
 * login shell's own is used, because a packaged app starts with a restricted `PATH` - the same
 * reason `collectCandidates` in `cli.ts` uses a login shell.
 */
export async function resolveMcpCommand(command: string, path: string | null = null): Promise<string | null> {
  const trimmed = command.trim();
  if (!trimmed) return null;
  if (isAbsolute(trimmed) || trimmed.startsWith(".")) return trimmed;
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync("where.exe", [trimmed], {
        timeout: 5_000,
        maxBuffer: 64 * 1024,
        ...(path === null ? {} : { env: { ...process.env, PATH: path } }),
      });
      return stdout.split(/\r?\n/u)[0]?.trim() || null;
    }
    // The assignment goes inside the command, not into the shell's environment: a login shell reads
    // the user's profile first, and a profile that appends to `PATH` would undo an inherited one.
    const search = path === null ? "" : `PATH=${shellWord(path)} `;
    const shell = loginShellCommand();
    const { stdout } = await execFileAsync(
      shell.command,
      [...shell.args, `${search}command -v -- ${shellWord(trimmed)}`],
      { timeout: 5_000, maxBuffer: 64 * 1024 },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * This user's own `PATH`, as their login shell builds it, or `null` when it cannot be read.
 *
 * Read once per run and reused, because every hand-off and every test would otherwise start a login
 * shell of its own. Windows has no equivalent: `where.exe` runs against the process `PATH` already.
 */
let loginShellPathOnce: Promise<string | null> | null = null;

export function loginShellPath(): Promise<string | null> {
  loginShellPathOnce ??= readLoginShellPath();
  return loginShellPathOnce;
}

async function readLoginShellPath(): Promise<string | null> {
  if (process.platform === "win32") return null;
  try {
    const shell = loginShellCommand();
    const { stdout } = await execFileAsync(shell.command, [...shell.args, 'printf %s "$PATH"'], {
      timeout: 5_000,
      maxBuffer: 64 * 1024,
    });
    // `printf` writes no newline, so the value is the last line whatever the user's profile printed
    // before it.
    return stdout.split(/\r?\n/u).pop()?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * The environment a stdio MCP server is launched with, `PATH` included.
 *
 * The login shell that found the command holds the `PATH` that makes it run: an `npx` or `uvx`
 * installed by nvm, Homebrew or mise starts with `#!/usr/bin/env node`, so it needs that same `PATH`
 * to find its own runtime. An app the user started from Finder or a launcher inherits none of it,
 * which is a server that tests green from a terminal and fails everywhere else. The configuration's
 * own pairs are applied last, so a `PATH` the user wrote there still wins.
 */
export function mcpLaunchEnvironment(server: UsableMcpServer): Record<string, string> {
  return { ...(server.path ? { PATH: server.path } : {}), ...mcpEnvironment(server.config) };
}

/**
 * The environment a stdio MCP server starts with, beyond the provider's own.
 *
 * `envPassthrough` is spent here and nowhere else: it names the variables this machine already
 * holds that the server needs, such as `HOME`. The configuration's own pairs are applied last, so
 * a user's explicit value always wins over an inherited one.
 */
export function mcpEnvironment(config: McpServerConfig): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const name of config.envPassthrough) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  for (const pair of config.env) environment[pair.key] = pair.value;
  return environment;
}

/** Claude reads a record keyed by name. Its stdio entry takes `cwd`; its http entry takes headers. */
export type ClaudeMcpServer =
  | { type: "stdio"; command: string; args: string[]; env: Record<string, string>; cwd?: string }
  | { type: "http"; url: string; headers: Record<string, string> };

export function claudeMcpServers(servers: readonly UsableMcpServer[]): Record<string, ClaudeMcpServer> {
  const record: Record<string, ClaudeMcpServer> = {};
  for (const server of servers) {
    if (server.error !== undefined) continue;
    const { config } = server;
    record[config.name] =
      config.transport === "stdio"
        ? {
            type: "stdio",
            command: server.command,
            args: [...config.args],
            env: mcpLaunchEnvironment(server),
            ...(server.workingDirectory ? { cwd: server.workingDirectory } : {}),
          }
        : { type: "http", url: config.url, headers: headerRecord(config) };
  }
  return record;
}

/**
 * ACP reads an array, and its environment and headers are `{ name, value }` pairs, not records.
 *
 * **No working directory.** `McpServerStdio` in the ACP schema carries only a name, a command,
 * arguments and an environment, so a server that names a directory is left out rather than started
 * in the provider's own. A server told to open `./data.db` would otherwise pass its test and then
 * create a second, empty database beside the agent's workspace. The form says so before the save.
 */
export type AcpMcpServer =
  | { name: string; command: string; args: string[]; env: Array<{ name: string; value: string }> }
  | { type: "http"; name: string; url: string; headers: Array<{ name: string; value: string }> };

export function acpMcpServers(servers: readonly UsableMcpServer[]): AcpMcpServer[] {
  const entries: AcpMcpServer[] = [];
  for (const server of servers) {
    if (server.error !== undefined) continue;
    const { config } = server;
    if (config.transport === "stdio") {
      if (config.workingDirectory) continue;
      entries.push({
        name: config.name,
        command: server.command,
        args: [...config.args],
        env: Object.entries(mcpLaunchEnvironment(server)).map(([name, value]) => ({ name, value })),
      });
    } else {
      entries.push({
        type: "http",
        name: config.name,
        url: config.url,
        headers: config.headers.map((pair) => ({ name: pair.key, value: pair.value })),
      });
    }
  }
  return entries;
}

/**
 * Codex reads `config.mcp_servers`, a record keyed by name, which `profile-generation.ts` already
 * writes to disable the user's own servers.
 *
 * **stdio only, and no working directory.** Neither the record's http shape nor a key for a working
 * directory could be confirmed against the pinned Codex app-server, and a guessed key name would
 * fail silently at the next turn. Both are left out of the Codex payload instead: a directory that
 * does not arrive would start the server in the wrong place, which a server told to open
 * `./data.db` answers by creating a second database. Every other capable provider still gets it.
 */
export type CodexMcpServer = { command: string; args: string[]; env: Record<string, string> };

export function codexMcpServers(servers: readonly UsableMcpServer[]): Record<string, CodexMcpServer> {
  const record: Record<string, CodexMcpServer> = {};
  for (const server of servers) {
    if (server.error !== undefined || server.config.transport !== "stdio") continue;
    if (server.config.workingDirectory) continue;
    record[server.config.name] = {
      command: server.command,
      args: [...server.config.args],
      env: mcpLaunchEnvironment(server),
    };
  }
  return record;
}

/**
 * What the Codex tool manifest records about the MCP set.
 *
 * Every field that changes what the server is, because Codex ignores the configuration on resume:
 * an edited command, argument, working directory or credential leaves a loaded session running the
 * old server, so it has to force a replacement session in the same way an added server does. The
 * manifest is a file on disk, so the secret values go in as a digest and never as themselves.
 */
export function mcpFingerprintValues(configs: readonly McpServerConfig[]): string[] {
  return configs
    .filter((config) => config.enabled && !isReservedMcpServerName(config.name))
    .map((config) =>
      [
        config.name,
        config.transport,
        config.command,
        config.args.join("\u0000"),
        config.envPassthrough.join("\u0000"),
        config.env.map((pair) => pair.key).join("\u0000"),
        config.workingDirectory,
        config.url,
        config.headers.map((pair) => pair.key).join("\u0000"),
        secretDigest(config),
      ].join("\u0001"),
    )
    .sort();
}

/** The values reduced to one digest, so a changed credential is visible without being readable. */
function secretDigest(config: McpServerConfig): string {
  const values = [...config.env, ...config.headers].map((pair) => `${pair.key}=${pair.value}`).join("\u0000");
  return createHash("sha256").update(values).digest("hex");
}

function headerRecord(config: McpServerConfig): Record<string, string> {
  return Object.fromEntries(config.headers.map((pair) => [pair.key, pair.value]));
}
