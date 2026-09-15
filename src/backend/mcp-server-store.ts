import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  createMcpServerId,
  isMcpKeyValue,
  isReservedMcpServerName,
  type McpKeyValue,
  type McpServerConfig,
  mcpConfigErrors,
  normalizeMcpConfig,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { databaseRow, databaseRows, requiredStringColumn } from "./database/database-rows";
import type { OpenBotDatabase } from "./openbot-database";

/**
 * The MCP server configurations this machine holds.
 *
 * These are written straight to the table, not through `database.dispatch`. A dispatch writes its
 * payload into the append-only `orchestration_events` table, and an MCP configuration carries
 * `Authorization` values and API keys: those must not land in a log that nothing ever deletes.
 * `channel-store.ts` and `database/agent-usage.ts` write directly for the same class of reason.
 *
 * Every write runs `normalizeMcpConfig` - the same function the settings form previews with - so a
 * stored row can never hold something the user was not shown.
 */
/**
 * A configuration the user can correct: a name already in use, the list at its limit, a row that was
 * deleted. Not a broken database, which stays an unexpected failure.
 *
 * The type is what carries the sentence out of the process. A local save reads `error.message` in a
 * toast, but the Team API answers a plain `Error` with a 500 "Request failed." - so a remote
 * administrator was told a duplicate name was a server fault, with nothing to correct it by. The
 * single catch in `team-api-server.ts` classifies by `instanceof`, and this class is what it reads.
 */
export class McpServerError extends Error {}

export class McpServerStore {
  constructor(private readonly database: OpenBotDatabase) {}

  list(): McpServerConfig[] {
    return databaseRows(
      this.database.connection.prepare("SELECT * FROM projection_mcp_servers ORDER BY position, mcp_server_id").all(),
    ).map(toConfig);
  }

  listEnabled(): McpServerConfig[] {
    return this.list().filter((config) => config.enabled);
  }

  get(mcpServerId: string): McpServerConfig | null {
    const row = databaseRow(
      this.database.connection.prepare("SELECT * FROM projection_mcp_servers WHERE mcp_server_id = ?").get(mcpServerId),
    );
    return row ? toConfig(row) : null;
  }

  /** Inserts or replaces one configuration and answers the stored form of it. */
  save(config: McpServerConfig, now = new Date().toISOString()): McpServerConfig {
    const normalized = normalizeMcpConfig(config);
    const errors = mcpConfigErrors(normalized);
    const firstError = errors.name ?? errors.command ?? errors.url;
    if (firstError) throw new McpServerError(firstError);

    const db = this.database.connection;
    db.exec("BEGIN IMMEDIATE");
    try {
      const existing = normalized.id ? this.get(normalized.id) : null;
      if (normalized.id && !existing) throw new McpServerError("This MCP server no longer exists.");
      if (!existing && this.count() >= INPUT_LIMITS.mcpServers)
        throw new McpServerError(`OpenBot keeps up to ${INPUT_LIMITS.mcpServers} MCP servers.`);
      // Reported here rather than left to the unique index, so the user reads a sentence.
      if (this.nameTaken(normalized.name, existing?.id ?? null))
        throw new McpServerError(`An MCP server named ${normalized.name} already exists.`);

      // A draft carries an empty id, which is not nullish - `??` would store the empty string.
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
      db.exec("COMMIT");
      return stored;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  remove(mcpServerId: string): void {
    this.database.connection.prepare("DELETE FROM projection_mcp_servers WHERE mcp_server_id = ?").run(mcpServerId);
  }

  setEnabled(mcpServerId: string, enabled: boolean, now = new Date().toISOString()): McpServerConfig {
    const current = this.get(mcpServerId);
    if (!current) throw new McpServerError("This MCP server no longer exists.");
    this.database.connection
      .prepare("UPDATE projection_mcp_servers SET enabled = ?, updated_at = ? WHERE mcp_server_id = ?")
      .run(enabled ? 1 : 0, now, mcpServerId);
    return { ...current, enabled };
  }

  private count(): number {
    return this.list().length;
  }

  private nameTaken(name: string, exceptId: string | null): boolean {
    if (isReservedMcpServerName(name)) return true;
    return this.list().some((config) => config.name === name && config.id !== exceptId);
  }

  private positionOf(mcpServerId: string): number {
    const index = this.list().findIndex((config) => config.id === mcpServerId);
    return index < 0 ? this.nextPosition() : index;
  }

  private nextPosition(): number {
    return this.list().length;
  }
}

/**
 * A row becomes a configuration only if every parsed value is the shape the spawn expects. A
 * hand-edited database must not be able to put a non-string into a child process environment.
 */
function toConfig(row: DynamicRecord): McpServerConfig {
  const transport = requiredStringColumn(row, "transport");
  if (transport !== "stdio" && transport !== "http") throw new Error("Invalid SQLite column transport.");
  return {
    id: requiredStringColumn(row, "mcp_server_id"),
    name: requiredStringColumn(row, "name"),
    transport,
    enabled: row.enabled === 1,
    command: requiredStringColumn(row, "command"),
    args: parseStrings(row, "args_json"),
    env: parsePairs(row, "env_json"),
    envPassthrough: parseStrings(row, "env_passthrough_json"),
    workingDirectory: requiredStringColumn(row, "working_directory"),
    url: requiredStringColumn(row, "url"),
    headers: parsePairs(row, "headers_json"),
  };
}

// A hand-edited database is untrusted input: a non-string here would reach a spawn's `env`, so
// every parsed column goes through a guard rather than being believed.
function parseStrings(row: DynamicRecord, key: string): string[] {
  return decodeStringList(JSON.parse(requiredStringColumn(row, key)), key);
}

function parsePairs(row: DynamicRecord, key: string): McpKeyValue[] {
  return decodePairList(JSON.parse(requiredStringColumn(row, key)), key);
}

function decodeStringList(value: unknown, key: string): string[] {
  if (!Array.isArray(value) || !value.every(isString)) throw new Error(`Invalid SQLite column ${key}.`);
  return value;
}

function decodePairList(value: unknown, key: string): McpKeyValue[] {
  if (!Array.isArray(value) || !value.every(isMcpKeyValue)) throw new Error(`Invalid SQLite column ${key}.`);
  return value;
}
