import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  createMcpServerId,
  isMcpKeyValue,
  isMcpServerConfig,
  isReservedMcpServerName,
  type McpKeyValue,
  type McpServerConfig,
  mcpConfigErrors,
  normalizeMcpConfig,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, type Logger } from "@openbot/logging";
import { databaseRow, databaseRows, requiredNumberColumn, requiredStringColumn } from "./database/database-rows";
import { withTransaction } from "./database/sqlite-transaction";
import { registerMcpSecretValues } from "./mcp-redaction";
import type { OpenBotDatabase } from "./openbot-database";

export class McpServerError extends Error {}

const MCP_REMOTE_BRIDGES: ReadonlyArray<{ name: string; remoteUrl: string; url: string }> = [
  { name: "canva", remoteUrl: "https://mcp.canva.com/mcp", url: "https://mcp.canva.com/mcp" },
  { name: "linear", remoteUrl: "https://mcp.linear.app/sse", url: "https://mcp.linear.app/mcp" },
  { name: "notion", remoteUrl: "https://mcp.notion.com/mcp", url: "https://mcp.notion.com/mcp" },
  { name: "figma", remoteUrl: "https://mcp.figma.com/mcp", url: "https://mcp.figma.com/mcp" },
  { name: "sentry", remoteUrl: "https://mcp.sentry.dev/mcp", url: "https://mcp.sentry.dev/mcp" },
  { name: "stripe", remoteUrl: "https://mcp.stripe.com", url: "https://mcp.stripe.com" },
];

const MCP_REMOTE_ARGS = (remoteUrl: string): string[] => ["-y", "mcp-remote@latest", remoteUrl];

export const CATALOG_PIN_MOVES: ReadonlyArray<{
  name: string;
  earlier: ReadonlyArray<readonly string[]>;
  current: readonly string[];
}> = [{ name: "apple-apps", earlier: [["-y", "mcp-icloud@2.1.3"]], current: ["-y", "mcp-icloud@2.1.4"] }];

function isCatalogNpxRow(row: DynamicRecord, name: string, args: readonly string[]): boolean {
  return row.name === name && row.transport === "stdio" && row.command === "npx" && isStringList(row.args_json, args);
}

export class McpServerStore {
  private readonly reported = new Set<string>();

  constructor(
    private readonly database: OpenBotDatabase,
    private readonly logger: Pick<Logger, "warn"> = createOpenBotLogger("mcp-server-store"),
  ) {}

  list(): McpServerConfig[] {
    return databaseRows(
      this.database.connection.prepare("SELECT * FROM projection_mcp_servers ORDER BY position, mcp_server_id").all(),
    ).flatMap((row) => readServer(row, this.report)?.config ?? []);
  }

  listEnabled(): McpServerConfig[] {
    return this.list().filter((config) => config.enabled);
  }

  get(mcpServerId: string): McpServerConfig | null {
    return this.read(mcpServerId)?.config ?? null;
  }

  save(config: McpServerConfig, now = new Date().toISOString()): McpServerConfig {
    const normalized = normalizeMcpConfig(config);
    const errors = mcpConfigErrors(normalized);
    const firstError = errors.name ?? errors.command ?? errors.url;
    if (firstError) throw new McpServerError(firstError);
    if (!isMcpServerConfig(normalized)) throw new McpServerError(sourceText("error.backend.mcpServerInvalid"));

    const db = this.database.connection;
    return withTransaction(db, () => {
      const existing = normalized.id ? this.get(normalized.id) : null;
      if (normalized.id && !existing) throw new McpServerError(sourceText("error.backend.mcpServerGone"));
      if (!existing && this.count() >= INPUT_LIMITS.mcpServers)
        throw new McpServerError(sourceText("error.backend.mcpServerLimit", { limit: INPUT_LIMITS.mcpServers }));
      if (this.nameTaken(normalized.name, existing?.id ?? null))
        throw new McpServerError(sourceText("error.backend.mcpServerNameTaken", { name: normalized.name }));

      const stored: McpServerConfig = { ...normalized, id: existing?.id || createMcpServerId() };
      db.prepare(
        `INSERT INTO projection_mcp_servers (
           mcp_server_id, name, transport, enabled, command, args_json, env_json, env_passthrough_json,
           working_directory, url, headers_json, position, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(mcp_server_id) DO UPDATE SET
           name = excluded.name,
           transport = excluded.transport,
           enabled = excluded.enabled,
           command = excluded.command,
           args_json = excluded.args_json,
           env_json = excluded.env_json,
           env_passthrough_json = excluded.env_passthrough_json,
           working_directory = excluded.working_directory,
           url = excluded.url,
           headers_json = excluded.headers_json,
           updated_at = excluded.updated_at`,
      ).run(
        stored.id,
        stored.name,
        stored.transport,
        stored.enabled ? 1 : 0,
        stored.command,
        JSON.stringify(stored.args),
        JSON.stringify(stored.env),
        JSON.stringify(stored.envPassthrough),
        stored.workingDirectory,
        stored.url,
        JSON.stringify(stored.headers),
        existing ? this.positionOf(stored.id) : this.nextPosition(),
        now,
        now,
      );
      return stored;
    });
  }

  remove(mcpServerId: string): void {
    this.database.connection.prepare("DELETE FROM projection_mcp_servers WHERE mcp_server_id = ?").run(mcpServerId);
  }

  setEnabled(mcpServerId: string, enabled: boolean, now = new Date().toISOString()): McpServerConfig {
    const stored = this.read(mcpServerId);
    if (!stored) throw new McpServerError(sourceText("error.backend.mcpServerGone"));
    const current = stored.config;
    if (enabled && stored.unreadable.length > 0) return this.save({ ...current, enabled }, now);
    this.database.connection
      .prepare("UPDATE projection_mcp_servers SET enabled = ?, updated_at = ? WHERE mcp_server_id = ?")
      .run(enabled ? 1 : 0, now, mcpServerId);
    return { ...current, enabled };
  }

  migrateCatalogRows(now = new Date().toISOString()): number {
    const db = this.database.connection;
    let converted = 0;
    return withTransaction(db, () => {
      const rows = databaseRows(
        db.prepare("SELECT mcp_server_id, name, transport, command, args_json FROM projection_mcp_servers").all(),
      );
      for (const row of rows) {
        const pin = CATALOG_PIN_MOVES.find((candidate) =>
          candidate.earlier.some((args) => isCatalogNpxRow(row, candidate.name, args)),
        );
        if (pin) {
          db.prepare("UPDATE projection_mcp_servers SET args_json = ?, updated_at = ? WHERE mcp_server_id = ?").run(
            JSON.stringify(pin.current),
            now,
            requiredStringColumn(row, "mcp_server_id"),
          );
          converted += 1;
          continue;
        }
        const bridge = MCP_REMOTE_BRIDGES.find((candidate) =>
          isCatalogNpxRow(row, candidate.name, MCP_REMOTE_ARGS(candidate.remoteUrl)),
        );
        if (!bridge) continue;
        db.prepare(
          `UPDATE projection_mcp_servers
             SET transport = 'http', command = '', args_json = '[]', url = ?, updated_at = ?
             WHERE mcp_server_id = ?`,
        ).run(bridge.url, now, requiredStringColumn(row, "mcp_server_id"));
        converted += 1;
      }
      return converted;
    });
  }

  private read(mcpServerId: string): StoredServer | null {
    const row = databaseRow(
      this.database.connection.prepare("SELECT * FROM projection_mcp_servers WHERE mcp_server_id = ?").get(mcpServerId),
    );
    return row ? readServer(row, this.report) : null;
  }

  private readonly report: ReportRow = (row, message, reason) => {
    const mcpServerId = isString(row.mcp_server_id) ? row.mcp_server_id : null;
    const key = `${mcpServerId}\u0000${reason}`;
    if (this.reported.has(key)) return;
    this.reported.add(key);
    this.logger.warn(message, { mcpServerId, reason });
  };

  private count(): number {
    const row = databaseRow(
      this.database.connection.prepare("SELECT COUNT(*) AS count FROM projection_mcp_servers").get(),
    );
    return row ? requiredNumberColumn(row, "count") : 0;
  }

  private nameTaken(name: string, exceptId: string | null): boolean {
    if (isReservedMcpServerName(name)) return true;
    const row = this.database.connection
      .prepare("SELECT 1 AS taken FROM projection_mcp_servers WHERE name = ? AND mcp_server_id IS NOT ?")
      .get(name, exceptId);
    return databaseRow(row) !== null;
  }

  private positionOf(mcpServerId: string): number {
    const row = databaseRow(
      this.database.connection
        .prepare("SELECT position FROM projection_mcp_servers WHERE mcp_server_id = ?")
        .get(mcpServerId),
    );
    return row ? requiredNumberColumn(row, "position") : this.nextPosition();
  }

  private nextPosition(): number {
    const row = databaseRow(
      this.database.connection
        .prepare("SELECT COALESCE(MAX(position) + 1, 0) AS position FROM projection_mcp_servers")
        .get(),
    );
    return row ? requiredNumberColumn(row, "position") : 0;
  }
}

interface StoredServer {
  config: McpServerConfig;
  unreadable: string[];
}

type ReportRow = (row: DynamicRecord, message: string, reason: string) => void;

function readServer(row: DynamicRecord, report: ReportRow): StoredServer | null {
  const unreadable: string[] = [];
  const unread = (key: string): never[] => {
    unreadable.push(key);
    return [];
  };
  const list = <T>(key: string, decode: (value: unknown, key: string) => T[]): T[] => {
    try {
      return decode(JSON.parse(requiredStringColumn(row, key)), key);
    } catch {
      return unread(key);
    }
  };
  let config: McpServerConfig;
  try {
    const transport = requiredStringColumn(row, "transport");
    if (transport !== "stdio" && transport !== "http") throw new Error("Invalid SQLite column transport.");
    config = {
      id: requiredStringColumn(row, "mcp_server_id"),
      name: requiredStringColumn(row, "name"),
      transport,
      enabled: row.enabled === 1,
      command: requiredStringColumn(row, "command"),
      args: list("args_json", decodeStringList),
      env: list("env_json", decodePairList),
      envPassthrough: list("env_passthrough_json", decodeStringList),
      workingDirectory: requiredStringColumn(row, "working_directory"),
      url: requiredStringColumn(row, "url"),
      headers: list("headers_json", decodePairList),
    };
  } catch (error) {
    report(row, "An MCP server row cannot be read, so it is left out.", error instanceof Error ? error.message : "");
    return null;
  }
  const bare: McpServerConfig = {
    ...config,
    command: "",
    args: [],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url: "",
    headers: [],
  };
  if (!isMcpServerConfig(bare)) {
    report(row, "An MCP server row cannot be read, so it is left out.", "The id or the name is past its limit.");
    return null;
  }
  const fits = (column: Partial<McpServerConfig>) => isMcpServerConfig({ ...bare, ...column });
  const unreadText = (key: string): "" => {
    unreadable.push(key);
    return "";
  };
  config = {
    ...config,
    command: fits({ command: config.command }) ? config.command : unreadText("command"),
    workingDirectory: fits({ workingDirectory: config.workingDirectory })
      ? config.workingDirectory
      : unreadText("working_directory"),
    url: fits({ url: config.url }) ? config.url : unreadText("url"),
    args: fits({ args: config.args }) ? config.args : unread("args_json"),
    env: fits({ env: config.env }) ? config.env : unread("env_json"),
    envPassthrough: fits({ envPassthrough: config.envPassthrough })
      ? config.envPassthrough
      : unread("env_passthrough_json"),
    headers: fits({ headers: config.headers }) ? config.headers : unread("headers_json"),
  };
  if (unreadable.length > 0) {
    config = { ...config, enabled: false };
    report(row, "An MCP server row has columns that cannot be read, so it is turned off.", unreadable.join(", "));
  }
  registerMcpSecretValues(config);
  return { config, unreadable };
}

function decodeStringList(value: unknown, key: string): string[] {
  if (!Array.isArray(value) || !value.every(isString)) throw new Error(`Invalid SQLite column ${key}.`);
  return value;
}

function isStringList(value: unknown, expected: readonly string[]): boolean {
  if (typeof value !== "string") return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return false;
  }
  return (
    Array.isArray(parsed) &&
    parsed.length === expected.length &&
    parsed.every((item, index) => item === expected[index])
  );
}

function decodePairList(value: unknown, key: string): McpKeyValue[] {
  if (!Array.isArray(value) || !value.every(isMcpKeyValue)) throw new Error(`Invalid SQLite column ${key}.`);
  return value;
}
