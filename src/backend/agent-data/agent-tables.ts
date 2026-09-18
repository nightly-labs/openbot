import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { SharedTable } from "@openbot/contracts/ipc";
import {
  AGENT_DATABASE_LIMITS,
  AGENT_DATABASE_METADATA_TABLE,
  type AgentDatabaseParameter,
  type AgentDatabaseRows,
  type AgentDatabaseValue,
} from "./agent-database-protocol";
import { type AgentDatabaseCheck, checkAgentSql, schemaChange } from "./agent-database-rules";
import type { AgentDatabaseSupervisor } from "./agent-database-supervisor";

export interface AgentTablesOptions {
  /** `~/OpenBot/Shared`. The `Data` directory under it is this class's alone. */
  sharedRoot: string;
  supervisor: AgentDatabaseSupervisor;
}

export interface AgentTableSummary {
  name: string;
  ownerAgentId: string | null;
  rowCount: number | null;
  /** The `CREATE TABLE` statement, so an agent can write correct SQL without a PRAGMA. */
  sql: string;
}

export interface AgentDatabaseQueryResult {
  columns: string[];
  rows: AgentDatabaseValue[][];
  truncated: boolean;
}

export interface AgentDatabaseWriteResult {
  changes: number;
  lastInsertRowid: number | null;
}

const DIRECTORY = "Data";
const FILE_NAME = "agent-data.db";

/** Tables SQLite reserves for itself, plus our own owner record. */
const HIDDEN_TABLES = `name NOT LIKE 'sqlite~_%' ESCAPE '~' AND name <> '${AGENT_DATABASE_METADATA_TABLE}'`;

/**
 * Owns the one shared database, `~/OpenBot/Shared/Data/agent-data.db`: the file, its owner record,
 * and the rule that decides who may remove a table.
 *
 * There is one database and many tables rather than a database per subject. An agent that wants to
 * keep people, tasks, and the messages it handled makes three tables, and it can join them, which a
 * file per subject cannot. Every agent may read and write every table -- they are shared on purpose,
 * so an agent leaves something the next agent can use instead of a private JSON file. The owner
 * record decides exactly one thing: who may drop or reshape a table. The user can delete any table
 * from agent settings, because the owner rule binds agents, not the person whose computer this is.
 *
 * This class never opens SQLite. It hands one statement at a time to
 * {@link AgentDatabaseSupervisor}, which owns the child process that does.
 */
export class AgentTables {
  readonly #directory: string;
  readonly #path: string;
  readonly #supervisor: AgentDatabaseSupervisor;
  #ready: Promise<AgentDatabaseCheck<true>> | null = null;

  constructor(options: AgentTablesOptions) {
    this.#directory = join(options.sharedRoot, DIRECTORY);
    this.#path = join(this.#directory, FILE_NAME);
    this.#supervisor = options.supervisor;
  }

  /** Every table with its owner and row count, for both the agent tool and agent settings. */
  async list(): Promise<AgentTableSummary[]> {
    const ready = await this.#ensure();
    if (!ready.ok) return [];

    const schema = await this.#send({
      mode: "read",
      sql: `SELECT name, sql FROM sqlite_master WHERE type = 'table' AND ${HIDDEN_TABLES} ORDER BY name`,
    });
    if (!schema.ok) return [];

    const names = schema.value.rows.map((row) => String(row[0]));
    const [owners, counts] = await Promise.all([this.#owners(), this.#rowCounts(names)]);
    return schema.value.rows.map((row) => {
      const name = String(row[0]);
      return {
        name,
        ownerAgentId: owners.get(name) ?? null,
        rowCount: counts.get(name) ?? null,
        sql: row[1] === null ? "" : String(row[1]),
      };
    });
  }

  /** What agent settings renders. The same listing, without the SQL the user has no use for. */
  async listShared(): Promise<SharedTable[]> {
    const tables = await this.list();
    return tables.map(({ name, ownerAgentId, rowCount }) => ({ name, ownerAgentId, rowCount }));
  }

  async query(
    sql: string,
    parameters: AgentDatabaseParameter[],
  ): Promise<AgentDatabaseCheck<AgentDatabaseQueryResult>> {
    const checked = await this.#prepare(sql, "read");
    if (!checked.ok) return checked;
    const result = await this.#send({ mode: "read", sql: checked.value, parameters });
    if (!result.ok) return { ok: false, message: result.message };
    const { columns, rows, truncated } = result.value;
    return { ok: true, value: { columns, rows, truncated } };
  }

  /**
   * One write, with the tables this agent did not create protected from `DROP` and `ALTER`.
   *
   * The protected list is read only for a statement that changes the schema, so an ordinary insert
   * costs one round trip rather than two, and the owner record is brought back in step afterwards --
   * that is how a table an agent creates with `CREATE TABLE` becomes a table it owns, with no
   * separate call to claim it.
   */
  async execute(
    agentId: string,
    sql: string,
    parameters: AgentDatabaseParameter[],
  ): Promise<AgentDatabaseCheck<AgentDatabaseWriteResult>> {
    const checked = await this.#prepare(sql, "write");
    if (!checked.ok) return checked;
    const change = schemaChange(checked.value);
    if (change === "create") {
      const room = await this.#roomForOneMore();
      if (!room.ok) return room;
    }
    const protectedTables = change === null ? [] : await this.#tablesNotOwnedBy(agentId);

    const result = await this.#send({ mode: "write", sql: checked.value, parameters, protectedTables });
    if (!result.ok) return { ok: false, message: result.message };
    if (change !== null) await this.#reconcileOwners(agentId);

    const { changes, lastInsertRowid } = result.value;
    return { ok: true, value: { changes, lastInsertRowid } };
  }

  /** The agent-facing delete. Only the agent that created a table may remove it. */
  async remove(agentId: string, name: string): Promise<AgentDatabaseCheck<string>> {
    const table = await this.#find(name);
    if (!table.ok) return table;

    const owner = table.value.ownerAgentId;
    if (owner !== null && owner !== agentId) {
      return {
        ok: false,
        message: `${table.value.name} was created by another agent. Ask that agent to remove it, or the user can remove it in agent settings.`,
      };
    }
    return this.#drop(agentId, table.value.name);
  }

  /** The user's delete, from agent settings. Not owner-gated: the data is on their computer. */
  async removeAsUser(name: string): Promise<void> {
    const table = await this.#find(name);
    if (!table.ok) throw new Error(table.message);
    const dropped = await this.#drop(null, table.value.name);
    if (!dropped.ok) throw new Error(dropped.message);
  }

  dispose(): void {
    this.#supervisor.dispose();
  }

  async #drop(agentId: string | null, name: string): Promise<AgentDatabaseCheck<string>> {
    const result = await this.#send({ mode: "write", sql: `DROP TABLE "${quote(name)}"`, provision: true });
    if (!result.ok) return { ok: false, message: result.message };
    await this.#reconcileOwners(agentId);
    return { ok: true, value: name };
  }

  async #find(name: string): Promise<AgentDatabaseCheck<AgentTableSummary>> {
    const wanted = name.trim().toLowerCase();
    const table = (await this.list()).find((entry) => entry.name.toLowerCase() === wanted);
    if (!table) return { ok: false, message: `There is no table called ${name}.` };
    return { ok: true, value: table };
  }

  async #prepare(sql: string, mode: "read" | "write"): Promise<AgentDatabaseCheck<string>> {
    const ready = await this.#ensure();
    if (!ready.ok) return ready;
    return checkAgentSql(sql, mode);
  }

  /**
   * The file and the owner record, made once per run.
   *
   * The result is remembered rather than the promise being re-created, so a hundred statements in
   * one turn do not each pay a `mkdir` and a `CREATE TABLE IF NOT EXISTS`.
   */
  #ensure(): Promise<AgentDatabaseCheck<true>> {
    this.#ready ??= this.#provision();
    return this.#ready;
  }

  async #provision(): Promise<AgentDatabaseCheck<true>> {
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    const created = await this.#send({
      mode: "write",
      provision: true,
      sql: `CREATE TABLE IF NOT EXISTS ${AGENT_DATABASE_METADATA_TABLE} (table_name TEXT PRIMARY KEY, owner_agent_id TEXT NOT NULL, created_at TEXT NOT NULL)`,
    });
    if (!created.ok) {
      // A failure here is worth another try on the next call: the host may have been killed mid-run.
      this.#ready = null;
      return { ok: false, message: created.message };
    }
    // The file exists only once the statement above ran, so the mode is tightened here rather than
    // at mkdir time.
    await chmod(this.#path, 0o600).catch(() => undefined);
    return { ok: true, value: true };
  }

  /**
   * Brings the owner record back in step with the tables that exist.
   *
   * SQLite itself is what decides a `CREATE TABLE` or `DROP TABLE` worked, so the record follows the
   * schema rather than the SQL: a table that appeared belongs to the agent that ran the statement,
   * and a row for a table that is gone is removed. Both statements are ours, so they run with
   * `provision` set -- nothing an agent writes can reach this table.
   */
  async #reconcileOwners(agentId: string | null): Promise<void> {
    await this.#send({
      mode: "write",
      provision: true,
      sql: `DELETE FROM ${AGENT_DATABASE_METADATA_TABLE} WHERE table_name NOT IN (SELECT name FROM sqlite_master WHERE type = 'table')`,
    });
    if (agentId === null) return;
    await this.#send({
      mode: "write",
      provision: true,
      sql: `INSERT OR IGNORE INTO ${AGENT_DATABASE_METADATA_TABLE} (table_name, owner_agent_id, created_at) SELECT name, ?, ? FROM sqlite_master WHERE type = 'table' AND ${HIDDEN_TABLES}`,
      parameters: [agentId, new Date().toISOString()],
    });
  }

  /**
   * The cap is on the whole store now that there is one file, so it is counted in tables rather
   * than in databases. It is a guard against a loop that makes a table per row, not a budget.
   */
  async #roomForOneMore(): Promise<AgentDatabaseCheck<true>> {
    const existing = await this.#send({
      mode: "read",
      sql: `SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND ${HIDDEN_TABLES}`,
    });
    const count = existing.ok ? existing.value.rows[0]?.[0] : 0;
    if (typeof count === "number" && count >= INPUT_LIMITS.sharedTables) {
      return {
        ok: false,
        message: `There are already ${INPUT_LIMITS.sharedTables} tables. Add columns or rows to a table that exists, or remove one you created.`,
      };
    }
    return { ok: true, value: true };
  }

  async #owners(): Promise<Map<string, string>> {
    const result = await this.#send({
      mode: "read",
      sql: `SELECT table_name, owner_agent_id FROM ${AGENT_DATABASE_METADATA_TABLE}`,
    });
    const owners = new Map<string, string>();
    // A file the user made by hand with the sqlite3 CLI has no owner record. Those are tables nobody
    // owns and anybody may remove, not an error.
    if (!result.ok) return owners;
    for (const row of result.value.rows) {
      if (typeof row[0] === "string" && typeof row[1] === "string" && row[1].length > 0) owners.set(row[0], row[1]);
    }
    return owners;
  }

  async #tablesNotOwnedBy(agentId: string): Promise<string[]> {
    const owners = await this.#owners();
    return [...owners].filter(([, owner]) => owner !== agentId).map(([table]) => table);
  }

  /**
   * Every table's count in one statement. An N+1 of counts would each pay their own deadline, and a
   * table too large to count inside one reports no count rather than failing the whole listing.
   */
  async #rowCounts(names: string[]): Promise<Map<string, number>> {
    if (names.length === 0) return new Map();
    const sql = names
      .map((name) => `SELECT ? AS name, COUNT(*) AS row_count FROM "${quote(name)}"`)
      .join(" UNION ALL ");
    const result = await this.#send({ mode: "read", sql, parameters: names });
    if (!result.ok) return new Map();
    const counts = new Map<string, number>();
    for (const row of result.value.rows) {
      if (typeof row[0] === "string" && typeof row[1] === "number") counts.set(row[0], row[1]);
    }
    return counts;
  }

  async #send(request: {
    mode: "read" | "write";
    sql: string;
    parameters?: AgentDatabaseParameter[];
    protectedTables?: string[];
    provision?: boolean;
  }): Promise<AgentDatabaseCheck<AgentDatabaseRows>> {
    const outcome = await this.#supervisor.send({
      kind: "statement",
      databasePath: this.#path,
      mode: request.mode,
      provision: request.provision ?? false,
      protectedTables: request.protectedTables ?? [],
      sql: request.sql,
      parameters: request.parameters ?? [],
      limits: AGENT_DATABASE_LIMITS,
    });
    return outcome.ok ? { ok: true, value: outcome.result } : { ok: false, message: outcome.failure.message };
  }
}

/** Escapes an identifier for the one place a table name is written into SQL rather than bound. */
function quote(name: string): string {
  return name.replaceAll('"', '""');
}
