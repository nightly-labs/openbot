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
import { registerMcpSecretValues } from "./mcp-redaction";
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

/**
 * The six sign-in listings as the shipped catalog described them before native OAuth: a stdio
 * row running the third-party `mcp-remote` bridge. The current catalog
 * (`marketplace/plugin-catalog/plugins/<slug>/plugin.json`, generated into
 * `marketplace-plugin-catalog.ts`) reaches the same servers over native http instead.
 *
 * A row installed from one of these still names the server, so the marketplace reads it as
 * installed and offers no way back in - while the bridge it runs no longer signs in. The migration
 * below rewrites exactly these rows.
 */
const MCP_REMOTE_BRIDGES: ReadonlyArray<{ name: string; remoteUrl: string; url: string }> = [
  { name: "canva", remoteUrl: "https://mcp.canva.com/mcp", url: "https://mcp.canva.com/mcp" },
  { name: "linear", remoteUrl: "https://mcp.linear.app/sse", url: "https://mcp.linear.app/mcp" },
  { name: "notion", remoteUrl: "https://mcp.notion.com/mcp", url: "https://mcp.notion.com/mcp" },
  { name: "figma", remoteUrl: "https://mcp.figma.com/mcp", url: "https://mcp.figma.com/mcp" },
  { name: "sentry", remoteUrl: "https://mcp.sentry.dev/mcp", url: "https://mcp.sentry.dev/mcp" },
  { name: "stripe", remoteUrl: "https://mcp.stripe.com", url: "https://mcp.stripe.com" },
];

const MCP_REMOTE_ARGS = (remoteUrl: string): string[] => ["-y", "mcp-remote@latest", remoteUrl];

export class McpServerStore {
  /** Each unreadable row is said once a process, because `list()` runs for every save and hand-off. */
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

  /** Inserts or replaces one configuration and answers the stored form of it. */
  save(config: McpServerConfig, now = new Date().toISOString()): McpServerConfig {
    const normalized = normalizeMcpConfig(config);
    const errors = mcpConfigErrors(normalized);
    const firstError = errors.name ?? errors.command ?? errors.url;
    if (firstError) throw new McpServerError(firstError);
    // The read guards are the bounds of the wire, so a row stored here is a row the next start can read.
    if (!isMcpServerConfig(normalized)) throw new McpServerError(sourceText("error.backend.mcpServerInvalid"));

    const db = this.database.connection;
    db.exec("BEGIN IMMEDIATE");
    try {
      const existing = normalized.id ? this.get(normalized.id) : null;
      if (normalized.id && !existing) throw new McpServerError(sourceText("error.backend.mcpServerGone"));
      if (!existing && this.count() >= INPUT_LIMITS.mcpServers)
        throw new McpServerError(sourceText("error.backend.mcpServerLimit", { limit: INPUT_LIMITS.mcpServers }));
      // Reported here rather than left to the unique index, so the user reads a sentence.
      if (this.nameTaken(normalized.name, existing?.id ?? null))
        throw new McpServerError(sourceText("error.backend.mcpServerNameTaken", { name: normalized.name }));

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
      // SQLite may have rolled back already, and a second ROLLBACK would replace the error that did it.
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }

  remove(mcpServerId: string): void {
    this.database.connection.prepare("DELETE FROM projection_mcp_servers WHERE mcp_server_id = ?").run(mcpServerId);
  }

  setEnabled(mcpServerId: string, enabled: boolean, now = new Date().toISOString()): McpServerConfig {
    const stored = this.read(mcpServerId);
    if (!stored) throw new McpServerError(sourceText("error.backend.mcpServerGone"));
    const current = stored.config;
    // Turned on, the columns that could not be read are stored as they are shown, empty, so the row
    // that runs is the row the user saw and the next read does not turn it off again. Turned off, the
    // row already reads as off, and its stored values stay.
    if (enabled && stored.unreadable.length > 0) return this.save({ ...current, enabled }, now);
    this.database.connection
      .prepare("UPDATE projection_mcp_servers SET enabled = ?, updated_at = ? WHERE mcp_server_id = ?")
      .run(enabled ? 1 : 0, now, mcpServerId);
    return { ...current, enabled };
  }

  /**
   * Converts rows installed from the old catalog's `mcp-remote` bridge definitions to the native
   * http rows the current catalog installs, and answers how many rows changed.
   *
   * Only a row that still matches a shipped definition exactly - name, stdio transport, `npx`,
   * and the bridge arguments - is converted. A renamed row cannot be told apart from one the user
   * wrote by hand, and changed arguments are the user's own edits: both stay as they are. Every
   * other column (id, enabled state, position, credentials, working directory) is kept, so the
   * row the user sees is the row they had, reaching its server natively. The converted row holds
   * no sign-in yet; Sign in on it opens the browser like any new installation.
   *
   * This is a data rewrite rather than a schema migration: no DDL changes, and running it again
   * converts nothing, so it runs on every startup rather than behind a schema version.
   */
  migrateCatalogBridgesToHttp(now = new Date().toISOString()): number {
    const db = this.database.connection;
    let converted = 0;
    db.exec("BEGIN IMMEDIATE");
    try {
      const rows = databaseRows(
        db.prepare("SELECT mcp_server_id, name, transport, command, args_json FROM projection_mcp_servers").all(),
      );
      for (const row of rows) {
        const bridge = MCP_REMOTE_BRIDGES.find(
          (candidate) =>
            row.name === candidate.name &&
            row.transport === "stdio" &&
            row.command === "npx" &&
            isStringList(row.args_json, MCP_REMOTE_ARGS(candidate.remoteUrl)),
        );
        if (!bridge) continue;
        db.prepare(
          `UPDATE projection_mcp_servers
             SET transport = 'http', command = '', args_json = '[]', url = ?, updated_at = ?
             WHERE mcp_server_id = ?`,
        ).run(bridge.url, now, requiredStringColumn(row, "mcp_server_id"));
        converted += 1;
      }
      db.exec("COMMIT");
      return converted;
    } catch (error) {
      // SQLite may have rolled back already, and a second ROLLBACK would replace the error that did it.
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
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

  // The table, not `list()`: a row that cannot be read still holds its name and its place in the limit.
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

  // The table too: an index in `list()` skips the rows left out, and would share their place.
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

/** A row as it was read, and the list columns that could not be read. */
interface StoredServer {
  config: McpServerConfig;
  unreadable: string[];
}

type ReportRow = (row: DynamicRecord, message: string, reason: string) => void;

/**
 * A row becomes a configuration only if every parsed value is the shape the spawn expects. A
 * hand-edited database must not be able to put a non-string into a child process environment.
 *
 * Startup reads this table, so one row must not stop the app (#3643). A list column that cannot be
 * read, or a column past a bound of `isMcpServerConfig`, is read as empty and the server as turned
 * off: the user still sees it in Server settings and corrects or removes it there. The row is not
 * changed until the user saves it or turns it on. A row whose text cannot be read at all, or whose id
 * or name is past a bound, has nothing to show, and is left out.
 */
// Every read goes through here, so each stored secret is masked in logs before any caller can
// pass it to a provider or quote it in an error.
function readServer(row: DynamicRecord, report: ReportRow): StoredServer | null {
  const unreadable: string[] = [];
  const unread = (key: string): never[] => {
    unreadable.push(key);
    return [];
  };
  // A hand-edited database is untrusted input: a non-string here would reach a spawn's `env`, so
  // every parsed column goes through a guard rather than being believed.
  const list = <T>(key: string, decode: (value: unknown, key: string) => T[]): T[] => {
    try {
      return decode(JSON.parse(requiredStringColumn(row, key)), key);
    } catch {
      // The parse error can quote the stored text, which can be a key: only the column is named.
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
    // These errors name a column only, never its value.
    report(row, "An MCP server row cannot be read, so it is left out.", error instanceof Error ? error.message : "");
    return null;
  }
  // The renderer decodes the whole list with `isMcpServerConfig`, so a row past one of its bounds -
  // from an earlier build or an import - would hide every server from Server settings. Each column
  // is checked alone; only the id and the name cannot be shown empty.
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

/** Whether a JSON column holds exactly the strings expected. A hand-edited value never matches. */
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
