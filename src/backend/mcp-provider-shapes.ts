import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import {
  type AgentProviderId,
  COMPUTER_USE_MCP_SERVER_ID,
  COMPUTER_USE_MCP_SERVER_NAME,
  isReservedMcpServerName,
  type McpServerConfig,
  type McpTransport,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect, Option, Schema } from "effect";
import { agentLaunchPath, forgetWindowsLookups, isExecutable, isWindowsRunnable, windowsPathExtensions } from "./cli";
import { causeHelpers } from "./effect-boundary";
import { isMissingFileError } from "./file-errors";
import type { McpOperationError } from "./mcp-effects";
import { getRecord } from "./protocol";

export type McpServerSource = (agentId?: string | null) => readonly McpServerConfig[];

export interface McpToolRuntimes {
  readonly binDirectories: readonly string[];
  readonly commandAliases: Readonly<Record<string, string>>;
  readonly catalogCommand?: (config: McpServerConfig) => McpCatalogCommand | "pending" | null;
}

interface McpCatalogCommand {
  command: string;
  args: readonly string[];
}

export const NO_MCP_TOOL_RUNTIMES: McpToolRuntimes = { binDirectories: [], commandAliases: {} };

export type McpToolRuntimeSource = () => McpToolRuntimes;

export interface McpEndpoint {
  url: string;
  authorization: string | null;
  proxied: boolean;
}

export interface McpEndpointRefusal {
  error: string;
}

export type McpEndpointSource = (
  config: McpServerConfig,
  agentId: string | null,
) => Effect.Effect<McpEndpoint | McpEndpointRefusal, McpOperationError>;

type McpDropReason =
  | "command_not_found"
  | "working_directory_unsupported"
  | "name_conflict"
  | "provider_limit"
  | "unusable"
  | "failed_to_start"
  | "failed_in_provider";

export interface McpServerDrop {
  name: string;
  reason: McpDropReason;
  detail: string;
  signIn?: boolean;
}

export type McpDropReporter = (provider: AgentProviderId, drops: readonly McpServerDrop[]) => void;

export interface McpHandoff<T> {
  servers: T;
  dropped: McpServerDrop[];
}

const WORKING_DIRECTORY_UNSUPPORTED = "This provider cannot start a server in a working directory.";

const NAME_CONFLICT = "Another MCP server has the same name for this provider.";

export type UsableMcpServer =
  | {
      config: McpServerConfig;
      command: string;
      args: string[];
      workingDirectory: string;
      path: string | null;
      url: string;
      authorization: string | null;
      proxied: boolean;
      error?: undefined;
      reason?: undefined;
    }
  | {
      config: McpServerConfig;
      command?: undefined;
      args?: undefined;
      workingDirectory?: undefined;
      path?: undefined;
      url?: undefined;
      authorization?: undefined;
      proxied?: undefined;
      error: string;
      reason: Exclude<McpDropReason, "working_directory_unsupported" | "name_conflict" | "provider_limit">;
    };

type UnusableMcpServer = Extract<UsableMcpServer, { error: string }>;

export type ResolvedMcpServer = Extract<UsableMcpServer, { error?: undefined }>;

function unusableDrop(server: UnusableMcpServer): McpServerDrop {
  return { name: server.config.name, reason: server.reason, detail: server.error };
}

export function agentMcpServers(configs: readonly McpServerConfig[], computerUse: boolean): readonly McpServerConfig[] {
  return computerUse ? configs : configs.filter((config) => config.id !== COMPUTER_USE_MCP_SERVER_ID);
}

export function computerUseParam(params: unknown): boolean {
  return !isDynamicRecord(params) || params.computerUse !== false;
}

export function mcpAgentParam(params: unknown): string | null {
  return isDynamicRecord(params) && typeof params.openbotAgentId === "string" ? params.openbotAgentId : null;
}

export const usableMcpServers = Effect.fnUntraced(function* (
  configs: readonly McpServerConfig[],
  tools: McpToolRuntimes = NO_MCP_TOOL_RUNTIMES,
  endpoint?: McpEndpointSource,
  agentId: string | null = null,
) {
  const candidates = configs.filter((config) => config.enabled && !isReservedMcpServerName(config.name));
  return yield* Effect.forEach(candidates, (config) => usableMcpServer(config, tools, endpoint, agentId), {
    concurrency: "unbounded",
  });
});

export const usableMcpServer = Effect.fnUntraced(function* (
  config: McpServerConfig,
  tools: McpToolRuntimes = NO_MCP_TOOL_RUNTIMES,
  endpoint?: McpEndpointSource,
  agentId: string | null = null,
): Effect.fn.Return<UsableMcpServer, McpShapeFailed> {
  if (config.transport !== "stdio") {
    const resolved = endpoint
      ? yield* endpoint(config, agentId).pipe(Effect.mapError(({ cause }) => new McpShapeFailed({ cause })))
      : { url: config.url, authorization: null, proxied: false };
    if ("error" in resolved) return { config, error: resolved.error, reason: "unusable" };
    return { config, command: "", args: [], workingDirectory: "", path: null, ...resolved };
  }
  const configured = mcpEnvironment(config).PATH;
  const path = appendToolRuntimes(configured ?? (yield* agentLaunchPath()), tools.binDirectories);
  const catalog = tools.catalogCommand?.(config) ?? null;
  if (catalog !== null && catalog !== "pending")
    return {
      config,
      command: catalog.command,
      args: [...catalog.args, ...config.args],
      workingDirectory: expandHomePath(config.workingDirectory),
      path,
      url: "",
      authorization: null,
      proxied: false,
    };
  const command = (yield* resolveMcpCommand(config.command, path)) ?? tools.commandAliases[config.command.trim()];
  if (!command)
    return {
      config,
      error: sourceText("error.backend.mcpCommandNotFound", { command: config.command }),
      reason: "command_not_found",
    };
  return {
    config,
    command,
    args: [...config.args],
    workingDirectory: expandHomePath(config.workingDirectory),
    path,
    url: "",
    authorization: null,
    proxied: false,
  };
});

function appendToolRuntimes(path: string | null, binDirectories: readonly string[]): string | null {
  if (binDirectories.length === 0) return path;
  const entries = (path ?? process.env.PATH ?? "").split(delimiter).filter((entry) => entry.length > 0);
  for (const directory of binDirectories) if (!entries.includes(directory)) entries.push(directory);
  return entries.join(delimiter);
}

function expandHomePath(value: string): string {
  const trimmed = value.trim();
  const homeRelative = process.platform === "win32" ? /^~[/\\]/u : /^~\//u;
  if (trimmed !== "~" && !homeRelative.test(trimmed)) return trimmed;
  const rest = trimmed.slice(2);
  return rest ? join(homedir(), rest) : homedir();
}

const resolvedCommands = new Map<string, Deferred.Deferred<string | null, McpShapeFailed>>();

const resolveMcpCommand = Effect.fn("McpShape.resolveCommand")(function* (command: string, path: string | null = null) {
  const trimmed = expandHomePath(command);
  if (!trimmed) return null;
  if (isAbsolute(trimmed)) return (yield* isMissingCommandFile(trimmed)) ? null : trimmed;
  if (trimmed.startsWith(".")) return trimmed;
  const key = `${path ?? ""}\u0000${trimmed}`;
  const cached = resolvedCommands.get(key);
  if (cached) return yield* Deferred.await(cached);
  const pending = Deferred.makeUnsafe<string | null, McpShapeFailed>();
  resolvedCommands.set(key, pending);
  return yield* lookUpMcpCommand(trimmed, path).pipe(
    Effect.tap((value) =>
      Effect.sync(() => {
        if (value === null && resolvedCommands.get(key) === pending) resolvedCommands.delete(key);
      }),
    ),
    Effect.onExit((exit) => Deferred.done(pending, exit)),
    Effect.uninterruptible,
  );
});

const COMMAND_FILE_CHECK_MS = 2_000;

const isMissingCommandFile = Effect.fn("McpShape.isMissingCommandFile")(function* (command: string) {
  if (process.platform === "win32" && !isWindowsRunnable(command, process.env.PATHEXT)) return false;
  return yield* mcpShapeIo(() => access(command)).pipe(
    Effect.as(false),
    Effect.catch(({ cause }) =>
      Effect.succeed(
        isMissingFileError(cause) || (cause instanceof Error && "code" in cause && cause.code === "ENOTDIR"),
      ),
    ),
    Effect.timeoutOrElse({ duration: COMMAND_FILE_CHECK_MS, orElse: () => Effect.succeed(false) }),
  );
});

export function clearMcpCommandCache(): void {
  resolvedCommands.clear();
  forgetWindowsLookups();
}

export function pickWindowsExecutable(stdout: string, pathext: string | undefined): string | null {
  const lines = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.find((line) => isWindowsRunnable(line, pathext)) ?? lines[0] ?? null;
}

const lookUpMcpCommand = Effect.fn("McpShape.lookUpCommand")(
  function* (trimmed: string, path: string | null) {
    const windows = process.platform === "win32";
    if (trimmed.includes("/") || (windows && trimmed.includes("\\"))) return null;
    const names = windows ? windowsCommandNames(trimmed, process.env.PATHEXT) : [trimmed];
    const value = path ?? process.env.PATH ?? "";
    let notRunnable: string | null = null;
    for (const folder of windows ? windowsPathEntries(value) : value.split(delimiter)) {
      if (!isAbsolute(folder)) continue;
      for (const name of names) {
        const candidate = join(folder, name);
        const found = yield* isExecutable(candidate).pipe(Effect.timeoutOption(COMMAND_FILE_CHECK_MS));
        if (Option.isNone(found)) break;
        if (!found.value) continue;
        if (!windows || isWindowsRunnable(candidate, process.env.PATHEXT)) return candidate;
        notRunnable ??= candidate;
      }
    }
    return notRunnable;
  },
  Effect.catch(() => Effect.succeed(null)),
);

function windowsPathEntries(value: string): string[] {
  return (value.match(/(?:"[^"]*"|[^;"])+/gu) ?? []).map((entry) => entry.replaceAll('"', "").trim());
}

function windowsCommandNames(command: string, pathext: string | undefined): string[] {
  if (isWindowsRunnable(command, pathext)) return [command];
  return [...windowsPathExtensions(pathext).map((extension) => `${command}${extension}`), command];
}

export const needsManagedRuntime = Effect.fn("McpShape.needsManagedRuntime")(function* (
  config: McpServerConfig,
  tools: McpToolRuntimes,
) {
  if (config.transport !== "stdio") return false;
  if (tools.catalogCommand?.(config) === "pending") return true;
  if (isAbsolute(expandHomePath(config.command))) return false;
  const resolved = yield* usableMcpServer(config, tools);
  return resolved.error !== undefined && resolved.reason === "command_not_found";
});

export function mcpLaunchEnvironment(server: UsableMcpServer): Record<string, string> {
  const environment = mcpEnvironment(server.config);
  if (server.path) environment.PATH = server.path;
  return environment;
}

export function mcpEnvironment(config: McpServerConfig): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const name of config.envPassthrough) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  for (const pair of config.env) environment[pair.key] = pair.value;
  return environment;
}

export type ClaudeMcpServer =
  | { type: "stdio"; command: string; args: string[]; env: Record<string, string>; cwd?: string }
  | { type: "http"; url: string; headers: Record<string, string> };

export function claudeMcpServers(
  servers: readonly UsableMcpServer[],
  userAgent?: string,
): McpHandoff<Record<string, ClaudeMcpServer>> {
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
            args: server.args,
            env: mcpLaunchEnvironment(server),
            ...(server.workingDirectory ? { cwd: server.workingDirectory } : {}),
          }
        : { type: "http", url: server.url, headers: withUserAgent(mcpHandoffHeaders(server), userAgent) };
  }
  return { servers: record, dropped };
}

function withUserAgent(headers: Record<string, string>, userAgent: string | undefined): Record<string, string> {
  if (!userAgent || Object.keys(headers).some((key) => key.toLowerCase() === "user-agent")) return headers;
  return { ...headers, "User-Agent": userAgent };
}

export type AcpMcpServer =
  | { name: string; command: string; args: string[]; env: Array<{ name: string; value: string }>; cwd?: string }
  | { type: "http"; name: string; url: string; headers: Array<{ name: string; value: string }> };

export function acpMcpServerName(
  config: McpServerConfig,
  own: readonly string[] = [],
  form: (name: string) => string = (name) => name,
): string {
  const name = form(providerMcpServerName(config.name));
  if (config.id === COMPUTER_USE_MCP_SERVER_ID || !own.includes(name)) return name;
  const renamed = form(`openbot_${name}`);
  return own.includes(renamed) || isReservedMcpServerName(renamed) ? name : renamed;
}

export function grokMcpServerName(name: string): string {
  const joined = name.replace(/_{2,}/gu, "_").replace(/_+$/u, "");
  if (joined === "") return "server";
  return /^[A-Za-z_]/u.test(joined) ? joined : `_${joined}`;
}

export function acpMcpServers(
  servers: readonly UsableMcpServer[],
  own: readonly string[] = [],
  form?: (name: string) => string,
  relaysStdio = false,
  limit = Number.POSITIVE_INFINITY,
): McpHandoff<AcpMcpServer[]> {
  const entries: AcpMcpServer[] = [];
  const dropped: McpServerDrop[] = [];
  const configured = new Set(servers.map((server) => server.config.name));
  for (const server of servers) {
    if (server.error !== undefined) {
      dropped.push(unusableDrop(server));
      continue;
    }
    const { config } = server;
    if (entries.length >= limit) {
      dropped.push({
        name: config.name,
        reason: "provider_limit",
        detail: sourceText("error.backend.mcpProviderLimit"),
      });
      continue;
    }
    const name = acpMcpServerName(config, own, form);
    if (
      entries.some((entry) => entry.name === name) ||
      (name !== config.name && (configured.has(name) || isReservedMcpServerName(name)))
    ) {
      dropped.push({ name: config.name, reason: "name_conflict", detail: NAME_CONFLICT });
      continue;
    }
    if (config.transport === "stdio") {
      if (config.workingDirectory && !relaysStdio) {
        dropped.push({
          name: config.name,
          reason: "working_directory_unsupported",
          detail: WORKING_DIRECTORY_UNSUPPORTED,
        });
        continue;
      }
      entries.push({
        name,
        command: server.command,
        args: server.args,
        env: Object.entries(mcpLaunchEnvironment(server)).map(([name, value]) => ({ name, value })),
        ...(config.workingDirectory ? { cwd: server.workingDirectory } : {}),
      });
    } else {
      entries.push({
        type: "http",
        name,
        url: server.url,
        headers: Object.entries(mcpHandoffHeaders(server)).map(([name, value]) => ({ name, value })),
      });
    }
  }
  return { servers: entries, dropped };
}

export type CodexMcpServer =
  | {
      command: string;
      args: string[];
      env: Record<string, string>;
      cwd?: string;
      enabled?: boolean;
      tools?: DynamicRecord;
    }
  | { url: string; http_headers: Record<string, string> };

export const CODEX_PLACEHOLDER_COMMAND = "openbot-mcp";
export const CODEX_PLACEHOLDER_URL = "http://127.0.0.1:1";

export type CodexOwnTransports = Readonly<Record<string, McpTransport>>;

export interface CodexOwnServers {
  disabled: Record<string, CodexDisabledMcpServer>;
  transports: CodexOwnTransports;
  read: DynamicRecord | null;
}

export function codexOwnTransports(configured: DynamicRecord | null): CodexOwnTransports {
  return Object.fromEntries(
    Object.entries(configured ?? {}).flatMap(([name, entry]): Array<[string, McpTransport]> => {
      if (!isDynamicRecord(entry)) return [];
      if (typeof entry.command === "string" && entry.command !== CODEX_PLACEHOLDER_COMMAND) return [[name, "stdio"]];
      if (typeof entry.url === "string" && entry.url !== CODEX_PLACEHOLDER_URL) return [[name, "http"]];
      return [];
    }),
  );
}

export const codexDisabledServers = Effect.fn("McpShape.codexDisabledServers")(function* (
  readConfig: () => Effect.Effect<DynamicRecord, McpShapeFailed>,
): Effect.fn.Return<CodexOwnServers, McpShapeFailed> {
  const config = yield* readConfig();
  const configured = getRecord(getRecord(config, "config"), "mcp_servers");
  return {
    disabled: Object.fromEntries(
      Object.keys(configured ?? {}).map((name) => {
        const tools = getRecord(getRecord(configured, name), "tools");
        return [name, { enabled: false, ...(tools ? { tools } : {}) } satisfies CodexDisabledMcpServer];
      }),
    ),
    transports: codexOwnTransports(configured),
    read: config,
  };
});

export interface CodexDisabledMcpServer {
  enabled: false;
  tools?: DynamicRecord;
}

export function providerMcpServerName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/gu, "_");
}

export function codexMcpServerKey(config: McpServerConfig, own: CodexOwnTransports = {}): string {
  const name = providerMcpServerName(config.name);
  if (config.id === COMPUTER_USE_MCP_SERVER_ID) return name;
  const renamed = `openbot_${name}`;
  const renamedTaken = Object.hasOwn(own, renamed) || isReservedMcpServerName(renamed);
  return renamedTaken && (!Object.hasOwn(own, name) || own[name] === config.transport) ? name : renamed;
}

function codexMcpServerKeyTaken(
  key: string,
  config: McpServerConfig,
  own: CodexOwnTransports,
  record: Readonly<Record<string, CodexMcpServer>>,
): boolean {
  if (Object.hasOwn(record, key)) return true;
  if (key === providerMcpServerName(config.name)) return false;
  return Object.hasOwn(own, key) || isReservedMcpServerName(key);
}

export function codexThreadMcpServers(
  disabled: Readonly<Record<string, CodexDisabledMcpServer>>,
  servers: Readonly<Record<string, CodexMcpServer>>,
): Record<string, CodexMcpServer | CodexDisabledMcpServer> {
  const record: Record<string, CodexMcpServer | CodexDisabledMcpServer> = { ...disabled, ...servers };
  for (const [name, server] of Object.entries(servers)) {
    record[name] = { ...disabled[name], ...server, enabled: true };
  }
  return record;
}

export function codexDirectMcpNamespaces(servers: Readonly<Record<string, CodexMcpServer>>): string[] {
  return Object.hasOwn(servers, COMPUTER_USE_MCP_SERVER_NAME) ? [`mcp__${COMPUTER_USE_MCP_SERVER_NAME}`] : [];
}

export function codexDeferredMcpServers(configs: readonly McpServerConfig[]): McpServerConfig[] {
  return configs.filter((config) => config.enabled && config.id !== COMPUTER_USE_MCP_SERVER_ID);
}

export function openCodeMcpServers(configs: readonly McpServerConfig[]): McpServerConfig[] {
  return configs.filter((config) => config.enabled && !isReservedMcpServerName(config.name));
}

export function codexMcpServers(
  servers: readonly UsableMcpServer[],
  own: CodexOwnTransports = {},
): McpHandoff<Record<string, CodexMcpServer>> {
  const record: Record<string, CodexMcpServer> = {};
  const dropped: McpServerDrop[] = [];
  for (const server of servers) {
    if (server.error !== undefined) {
      dropped.push(unusableDrop(server));
      continue;
    }
    const name = codexMcpServerKey(server.config, own);
    if (codexMcpServerKeyTaken(name, server.config, own, record)) {
      dropped.push({ name: server.config.name, reason: "name_conflict", detail: NAME_CONFLICT });
      continue;
    }
    if (server.config.transport === "stdio") {
      record[name] = {
        command: server.command,
        args: server.args,
        env: mcpLaunchEnvironment(server),
        ...(server.workingDirectory ? { cwd: server.workingDirectory } : {}),
      };
    } else {
      record[name] = {
        url: server.url,
        http_headers: mcpHandoffHeaders(server),
      };
    }
  }
  return { servers: record, dropped };
}

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

function secretDigest(config: McpServerConfig): string {
  const values = [...config.env, ...config.headers].map((pair) => `${pair.key}=${pair.value}`).join("\u0000");
  return createHash("sha256").update(values).digest("hex");
}

export function mcpHandoffHeaders(server: ResolvedMcpServer): Record<string, string> {
  if (server.proxied) return server.authorization ? { Authorization: `Bearer ${server.authorization}` } : {};
  const headers = Object.fromEntries(server.config.headers.map((pair) => [pair.key, pair.value]));
  const named = Object.keys(headers).some((key) => key.toLowerCase() === "authorization");
  if (server.authorization && !named) headers.Authorization = `Bearer ${server.authorization}`;
  return headers;
}

export class McpShapeFailed extends Schema.TaggedError<McpShapeFailed>()("McpShapeFailed", {
  cause: Schema.Defect(),
}) {}

const { io: mcpShapeIo, rewrap: toMcpShapeFailed } = causeHelpers(McpShapeFailed);

export { toMcpShapeFailed };
