import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";
import { isReservedMcpServerName, type McpServerConfig } from "@openbot/contracts/ipc";
import { loginShellCommand } from "./cli";

const execFileAsync = promisify(execFile);

/** Where a provider client reads the enabled configurations at spawn. */
export type McpServerSource = () => readonly McpServerConfig[];

/** A configuration with its stdio command resolved, or the reason it cannot start. */
export type UsableMcpServer =
  | { config: McpServerConfig; command: string; error?: undefined }
  | { config: McpServerConfig; command?: undefined; error: string };

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
  if (config.transport !== "stdio") return { config, command: "" };
  const command = await resolveMcpCommand(config.command);
  if (!command) return { config, error: `Command not found: ${config.command}` };
  return { config, command };
}

/**
 * An absolute path for a command name, or `null` when the machine has none. A command the user
 * already wrote as a path is taken as written: it is their statement of which build to run.
 */
export async function resolveMcpCommand(command: string): Promise<string | null> {
  const trimmed = command.trim();
  if (!trimmed) return null;
  if (isAbsolute(trimmed) || trimmed.startsWith(".")) return trimmed;
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync("where.exe", [trimmed], { timeout: 5_000, maxBuffer: 64 * 1024 });
      return stdout.split(/\r?\n/u)[0]?.trim() || null;
    }
    // A login shell, because a packaged app starts with a restricted PATH - the same reason
    // `collectCandidates` in `cli.ts` uses one.
    const shell = loginShellCommand();
    const { stdout } = await execFileAsync(shell.command, [...shell.args, `command -v ${trimmed}`], {
      timeout: 5_000,
      maxBuffer: 64 * 1024,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
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
            env: mcpEnvironment(config),
            ...(config.workingDirectory ? { cwd: config.workingDirectory } : {}),
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
        env: Object.entries(mcpEnvironment(config)).map(([name, value]) => ({ name, value })),
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
      env: mcpEnvironment(server.config),
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
