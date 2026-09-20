import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { type AgentProviderId, isReservedMcpServerName, type McpServerConfig } from "@openbot/contracts/ipc";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { loginShellCommand } from "./cli";
import { getRecord } from "./protocol";

const execFileAsync = promisify(execFile);

/** Where a provider client reads the enabled configurations at spawn. */
export type McpServerSource = () => readonly McpServerConfig[];

/**
 * What OpenBot can lend a machine that does not have it: the `bin` directories of the tool runtimes
 * it downloaded, and the command words it can answer itself.
 *
 * Both are a floor, never a choice. The directories are appended *after* the user's own `PATH`, so
 * a machine with nvm, Homebrew or mise keeps the Node it installed, and an alias is read only once
 * a lookup in that whole `PATH` has found nothing. That ordering is what makes the managed runtime
 * a pure addition: no machine that starts a server today starts a different one afterwards.
 */
export interface McpToolRuntimes {
  readonly binDirectories: readonly string[];
  /** Command word to the absolute program that answers it, such as `npx` to the managed `bunx`. */
  readonly commandAliases: Readonly<Record<string, string>>;
}

/** The machine exactly as it is. Used by every caller that has no runtime manager, including tests. */
export const NO_MCP_TOOL_RUNTIMES: McpToolRuntimes = { binDirectories: [], commandAliases: {} };

/**
 * Read at each spawn, like the configurations themselves: a runtime that finished downloading after
 * the app started has to count, and one the user removed has to stop counting.
 */
export type McpToolRuntimeSource = () => McpToolRuntimes;

/**
 * The bearer token for an http server this machine has signed in to, or `null` for every other one.
 *
 * Read at each spawn and never stored on the row: the token is OpenBot's to refresh, and a value in
 * the configuration would be a credential the panel shows, the Team API carries and a user edits.
 * Asked per configuration rather than per URL, so a listing that grows a second way in can answer
 * differently without this signature moving.
 */
export type McpAuthorizationSource = (config: McpServerConfig) => Promise<string | null>;

/**
 * Why an enabled configuration was not given to a provider.
 *
 * `working_directory_unsupported` is the only one that describes a perfectly valid server: it names
 * a provider's limit, not the user's mistake, so it is the same server every time and the panel can
 * say so without probing anything.
 */
export type McpDropReason = "command_not_found" | "working_directory_unsupported" | "unusable";

/** One server a provider did not get, named so the user can be told which one and why. */
export interface McpServerDrop {
  name: string;
  reason: McpDropReason;
  detail: string;
}

/**
 * How a client says what it could not carry. `AgentService` is the only implementation, so that one
 * class stays the single writer of the log and the single source of the event the renderer shows.
 */
export type McpDropReporter = (provider: AgentProviderId, drops: readonly McpServerDrop[]) => void;

/**
 * What one provider is given, and what it had to be refused.
 *
 * The adapters used to answer only the first half and drop the rest with a bare `continue`, so a
 * server that never reached a provider produced nothing at all: no log line, no event, and no
 * stderr from the provider either, because nothing was ever handed over to fail. The caller reports
 * `dropped`; see `AgentService.#reportMcpDrops`.
 */
export interface McpHandoff<T> {
  servers: T;
  dropped: McpServerDrop[];
}

/** Said by both providers that cannot carry one, so the user reads the same sentence either way. */
const WORKING_DIRECTORY_UNSUPPORTED = "This provider cannot start a server in a working directory.";

/**
 * A configuration with its stdio command, directory and `PATH` resolved, or why it cannot start.
 *
 * `path` is both the `PATH` the command was looked up in and the one the server is launched with.
 * The two have to be the same: a lookup in another `PATH` answers for another build of the command.
 */
export type UsableMcpServer =
  | {
      config: McpServerConfig;
      command: string;
      workingDirectory: string;
      path: string | null;
      /** The bearer token OpenBot holds for this server, added at hand-off. `null` for all others. */
      authorization: string | null;
      error?: undefined;
      reason?: undefined;
    }
  | {
      config: McpServerConfig;
      command?: undefined;
      workingDirectory?: undefined;
      path?: undefined;
      authorization?: undefined;
      error: string;
      /** Machine-readable beside the sentence, so a reporter never has to match on the wording. */
      reason: Exclude<McpDropReason, "working_directory_unsupported">;
    };

/** The failed arm, for the readers that have already narrowed to it. */
type UnusableMcpServer = Extract<UsableMcpServer, { error: string }>;

/** The arm a provider is actually given, for the readers that have already narrowed to it. */
export type ResolvedMcpServer = Extract<UsableMcpServer, { error?: undefined }>;

/** A server that could not be resolved at all. Every provider refuses these for the same reason. */
function unusableDrop(server: UnusableMcpServer): McpServerDrop {
  return { name: server.config.name, reason: server.reason, detail: server.error };
}

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
export async function usableMcpServers(
  configs: readonly McpServerConfig[],
  tools: McpToolRuntimes = NO_MCP_TOOL_RUNTIMES,
  authorization?: McpAuthorizationSource,
): Promise<UsableMcpServer[]> {
  const candidates = configs.filter((config) => config.enabled && !isReservedMcpServerName(config.name));
  return Promise.all(candidates.map((config) => usableMcpServer(config, tools, authorization)));
}

/**
 * One configuration made usable, whether or not it is enabled.
 *
 * A test answers for the configuration in front of the user, and a user may well test a server
 * before turning it on - so this one, unlike `usableMcpServers`, does not filter.
 */
export async function usableMcpServer(
  config: McpServerConfig,
  tools: McpToolRuntimes = NO_MCP_TOOL_RUNTIMES,
  authorization?: McpAuthorizationSource,
): Promise<UsableMcpServer> {
  // An http server starts no process, so it needs neither a command nor a `PATH`. It is the only
  // kind that can carry a sign-in, because a token travels in a header.
  if (config.transport !== "stdio") {
    return {
      config,
      command: "",
      workingDirectory: "",
      path: null,
      authorization: (await authorization?.(config)) ?? null,
    };
  }
  // A `PATH` the configuration carries is the one the server runs with, so it is the one the command
  // is looked up in: `python` with a virtual environment's `PATH` names that interpreter, and the
  // absolute path a login shell answered with would silently be a different one.
  const configured = mcpEnvironment(config).PATH;
  const path = appendToolRuntimes(configured ?? (await loginShellPath()), tools.binDirectories);
  const command = (await resolveMcpCommand(config.command, path)) ?? tools.commandAliases[config.command.trim()];
  if (!command) return { config, error: `Command not found: ${config.command}`, reason: "command_not_found" };
  return {
    config,
    command,
    workingDirectory: resolveMcpWorkingDirectory(config.workingDirectory),
    path,
    authorization: null,
  };
}

/**
 * The managed directories after everything the machine already had, and `null` when there is
 * nothing at all to search.
 *
 * Last, not first: see `McpToolRuntimes`. A directory already on the list is not added again, so a
 * user who put the managed `bin` on their own `PATH` keeps the position they chose for it.
 */
function appendToolRuntimes(path: string | null, binDirectories: readonly string[]): string | null {
  if (binDirectories.length === 0) return path;
  const entries = path ? path.split(delimiter) : [];
  for (const directory of binDirectories) if (!entries.includes(directory)) entries.push(directory);
  return entries.join(delimiter);
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
export function resolveMcpCommand(command: string, path: string | null = null): Promise<string | null> {
  const trimmed = command.trim();
  if (!trimmed) return Promise.resolve(null);
  if (isAbsolute(trimmed) || trimmed.startsWith(".")) return Promise.resolve(trimmed);
  // The `PATH` belongs in the key: the same word looked up in two lists names two builds, which is
  // the invariant the type comment above states.
  const key = `${path ?? ""}\u0000${trimmed}`;
  const cached = resolvedCommands.get(key);
  if (cached) return cached;
  const pending = rememberMcpCommand(key, trimmed, path);
  resolvedCommands.set(key, pending);
  return pending;
}

/**
 * Every command resolved in this run, so a thread start does not pay for a login shell per server.
 *
 * The promise is stored rather than the value, so two servers naming the same command in one
 * hand-off share one shell instead of racing two. A miss is forgotten again, because a user who
 * installs the tool that was missing must not have to restart the app to be believed.
 */
const resolvedCommands = new Map<string, Promise<string | null>>();

/** Drops a cached miss, and keeps every hit. */
async function rememberMcpCommand(key: string, command: string, path: string | null): Promise<string | null> {
  const resolved = await lookUpMcpCommand(command, path);
  if (resolved === null) resolvedCommands.delete(key);
  return resolved;
}

/**
 * Forgets what every command resolved to.
 *
 * The Test button is the user asking about *now* - usually straight after installing the thing that
 * was missing - so it starts from nothing. Nothing else clears this: a hand-off wants the answer the
 * probe gave, or the panel and the agent would disagree.
 */
export function clearMcpCommandCache(): void {
  resolvedCommands.clear();
}

/** The extensions Windows runs when `PATHEXT` is unset, in the order the system itself uses. */
const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

/**
 * The first `where.exe` line this machine can actually spawn.
 *
 * `where.exe npx` on a machine with Node answers `npx` before `npx.cmd`: the first is a shell script
 * for Git Bash and has no extension Windows can run. Providers spawn an MCP server with no shell, so
 * handing that line over is a server that never starts. The order is otherwise kept as `where.exe`
 * gave it, because that order is the user's own `PATH` and so their statement of which build to run.
 *
 * A line that matches nothing in `PATHEXT` is still answered with, unchanged from before this
 * function existed: an extensionless program is normal everywhere except Windows, and refusing one
 * here would turn a working configuration into a missing command.
 */
export function pickWindowsExecutable(stdout: string, pathext: string | undefined): string | null {
  const lines = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const runnable = new Set(
    (pathext?.trim() || DEFAULT_PATHEXT)
      .split(";")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.startsWith(".")),
  );
  return lines.find((line) => runnable.has(windowsExtension(line))) ?? lines[0] ?? null;
}

/** The last extension of a path, or `""`. A dot inside a directory name is not one. */
function windowsExtension(line: string): string {
  const dot = line.lastIndexOf(".");
  const separator = Math.max(line.lastIndexOf("\\"), line.lastIndexOf("/"));
  return dot > separator ? line.slice(dot).toLowerCase() : "";
}

async function lookUpMcpCommand(trimmed: string, path: string | null): Promise<string | null> {
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync("where.exe", [trimmed], {
        timeout: 5_000,
        maxBuffer: 64 * 1024,
        ...(path === null ? {} : { env: { ...process.env, PATH: path } }),
      });
      return pickWindowsExecutable(stdout, process.env.PATHEXT);
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

export function claudeMcpServers(servers: readonly UsableMcpServer[]): McpHandoff<Record<string, ClaudeMcpServer>> {
  const record: Record<string, ClaudeMcpServer> = {};
  const dropped: McpServerDrop[] = [];
  for (const server of servers) {
    if (server.error !== undefined) {
      dropped.push(unusableDrop(server));
      continue;
    }
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
        : { type: "http", url: config.url, headers: mcpHandoffHeaders(server) };
  }
  return { servers: record, dropped };
}

/**
 * ACP reads an array, and its environment and headers are `{ name, value }` pairs, not records.
 *
 * **No working directory.** `McpServerStdio` in the ACP schema carries only a name, a command,
 * arguments and an environment, so a server that names a directory is left out rather than started
 * in the provider's own. A server told to open `./data.db` would otherwise pass its test and then
 * create a second, empty database beside the agent's workspace. The form says so before the save,
 * the row says so afterwards, and the hand-off reports it as a drop.
 */
export type AcpMcpServer =
  | { name: string; command: string; args: string[]; env: Array<{ name: string; value: string }> }
  | { type: "http"; name: string; url: string; headers: Array<{ name: string; value: string }> };

export function acpMcpServers(servers: readonly UsableMcpServer[]): McpHandoff<AcpMcpServer[]> {
  const entries: AcpMcpServer[] = [];
  const dropped: McpServerDrop[] = [];
  for (const server of servers) {
    if (server.error !== undefined) {
      dropped.push(unusableDrop(server));
      continue;
    }
    const { config } = server;
    if (config.transport === "stdio") {
      if (config.workingDirectory) {
        dropped.push({
          name: config.name,
          reason: "working_directory_unsupported",
          detail: WORKING_DIRECTORY_UNSUPPORTED,
        });
        continue;
      }
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
        headers: Object.entries(mcpHandoffHeaders(server)).map(([name, value]) => ({ name, value })),
      });
    }
  }
  return { servers: entries, dropped };
}

/**
 * Codex reads `config.mcp_servers`, a record keyed by name, which `profile-generation.ts` already
 * writes to disable the user's own servers.
 *
 * **stdio needs no working directory.** Neither a key for a working directory nor any other guess
 * could be confirmed against the pinned Codex app-server, and a guessed key name would fail
 * silently at the next turn. A server that names a directory is left out of the Codex payload
 * instead: a directory that does not arrive would start the server in the wrong place, which a
 * server told to open `./data.db` answers by creating a second database. Every other capable
 * provider still gets it.
 *
 * **http travels as `url` with `http_headers`.** Both were confirmed against the pinned Codex
 * app-server: an entry with an invalid credential is listed as failed with the server's own 401,
 * which is the handshake reaching the server rather than the shape being dropped.
 */
export type CodexMcpServer =
  | { command: string; args: string[]; env: Record<string, string> }
  | { url: string; http_headers: Record<string, string> };

/**
 * The names Codex holds in `~/.codex/config.toml`, each turned off.
 *
 * Codex merges its own file into the thread configuration, so without this an agent's tools depend
 * on a file OpenBot's panel does not show, and two computers with the same OpenBot settings give
 * different tools. `profile-generation.ts` has swept these since the profile step existed; a normal
 * thread gets the same treatment, with OpenBot's own entries spread on top so a colliding name
 * resolves to the one the panel shows.
 *
 * The reader is passed in, because this module knows the payload shape and not the transport. An
 * empty record is the answer when the provider holds no configuration of its own.
 */
export async function codexDisabledServers(
  readConfig: () => Promise<DynamicRecord>,
): Promise<Record<string, CodexDisabledMcpServer>> {
  const configured = getRecord(getRecord(await readConfig(), "config"), "mcp_servers");
  return Object.fromEntries(Object.keys(configured ?? {}).map((name) => [name, { enabled: false } as const]));
}

/** A name Codex found in its own file and must not start. It carries no command; that is the point. */
export interface CodexDisabledMcpServer {
  enabled: false;
}

export function codexMcpServers(servers: readonly UsableMcpServer[]): McpHandoff<Record<string, CodexMcpServer>> {
  const record: Record<string, CodexMcpServer> = {};
  const dropped: McpServerDrop[] = [];
  for (const server of servers) {
    if (server.error !== undefined) {
      dropped.push(unusableDrop(server));
      continue;
    }
    if (server.config.transport === "stdio") {
      if (server.config.workingDirectory) {
        dropped.push({
          name: server.config.name,
          reason: "working_directory_unsupported",
          detail: WORKING_DIRECTORY_UNSUPPORTED,
        });
        continue;
      }
      record[server.config.name] = {
        command: server.command,
        args: [...server.config.args],
        env: mcpLaunchEnvironment(server),
      };
    } else {
      record[server.config.name] = {
        url: server.config.url,
        http_headers: mcpHandoffHeaders(server),
      };
    }
  }
  return { servers: record, dropped };
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

/**
 * The headers one http server is handed, with the OAuth token added here and only here.
 *
 * The token is never written to the row. That is the whole reason this stage exists: a credential
 * `mcp-remote` kept in a file of its own was one OpenBot could not redact, and a credential written
 * into `McpServerConfig.headers` would be one the panel shows, the Team API carries to a remote
 * administrator, and a user can edit into something OpenBot then refreshes over. Injected at the
 * hand-off, it is a value `McpHandoffLog` has already seen, so every log, export and send path
 * removes it.
 *
 * A header the user typed wins. Someone who pasted their own `Authorization` has said which
 * credential this server takes, and silently replacing it would be OpenBot overruling them with an
 * account they did not choose.
 */
export function mcpHandoffHeaders(server: ResolvedMcpServer): Record<string, string> {
  const headers = Object.fromEntries(server.config.headers.map((pair) => [pair.key, pair.value]));
  const named = Object.keys(headers).some((key) => key.toLowerCase() === "authorization");
  if (server.authorization && !named) headers.Authorization = `Bearer ${server.authorization}`;
  return headers;
}
