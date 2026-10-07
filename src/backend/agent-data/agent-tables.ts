import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { SharedTable } from "@openbot/contracts/ipc";
import { Effect, Schema } from "effect";
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
  #ready: Effect.Effect<AgentDatabaseCheck<true>, AgentTablesError> | null = null;

  constructor(options: AgentTablesOptions) {
    this.#directory = join(options.sharedRoot, DIRECTORY);
    this.#path = join(this.#directory, FILE_NAME);
    this.#supervisor = options.supervisor;
  }

  /** Every table with its owner and row count, for both the agent tool and agent settings. */

  list(): Effect.Effect<AgentTableSummary[], AgentTablesError> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<AgentTableSummary[], AgentTablesError> {
      const ready = yield* this.#ensure();
      if (!ready.ok) return [];

      const schema = yield* this.#send({
        mode: "read",
        sql: `SELECT name, sql FROM sqlite_master WHERE type = 'table' AND ${HIDDEN_TABLES} ORDER BY name`,
      });
      if (!schema.ok) return [];

      const names = schema.value.rows.map((row) => String(row[0]));
      const [owners, counts] = yield* Effect.all([this.#owners(), this.#rowCounts(names)], {
        concurrency: "unbounded",
      });
      return schema.value.rows.map((row) => {
        const name = String(row[0]);
        return {
          name,
          ownerAgentId: owners.get(name) ?? null,
          rowCount: counts.get(name) ?? null,
          sql: row[1] === null ? "" : String(row[1]),
        };
      });
    });
  }

  /** What agent settings renders. The same listing, without the SQL the user has no use for. */

  listShared(): Effect.Effect<SharedTable[], AgentTablesError> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<SharedTable[], AgentTablesError> {
      const tables = yield* this.list();
      return tables.map(({ name, ownerAgentId, rowCount }) => ({ name, ownerAgentId, rowCount }));
    });
  }

  query(
    sql: string,
    parameters: AgentDatabaseParameter[],
  ): Effect.Effect<AgentDatabaseCheck<AgentDatabaseQueryResult>, AgentTablesError> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<
      AgentDatabaseCheck<AgentDatabaseQueryResult>,
      AgentTablesError
    > {
      const checked = yield* this.#prepare(sql, "read");
      if (!checked.ok) return checked;
      const result = yield* this.#send({ mode: "read", sql: checked.value, parameters });
      if (!result.ok) return { ok: false, message: result.message };
      const { columns, rows, truncated } = result.value;
      return { ok: true, value: { columns, rows, truncated } };
    });
  }

  /**
   * One write, with the tables this agent did not create protected from `DROP` and `ALTER`.
   *
   * The protected list is read only for a statement that changes the schema, so an ordinary insert
   * costs one round trip rather than two, and the owner record is brought back in step afterwards --
   * that is how a table an agent creates with `CREATE TABLE` becomes a table it owns, with no
   * separate call to claim it.
   */

  execute(
    agentId: string,
    sql: string,
    parameters: AgentDatabaseParameter[],
  ): Effect.Effect<AgentDatabaseCheck<AgentDatabaseWriteResult>, AgentTablesError> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<
      AgentDatabaseCheck<AgentDatabaseWriteResult>,
      AgentTablesError
    > {
      const checked = yield* this.#prepare(sql, "write");
      if (!checked.ok) return checked;
      const change = schemaChange(checked.value);
      if (change === "create") {
        const room = yield* this.#roomForOneMore();
        if (!room.ok) return room;
      }
      const protectedTables = change === null ? [] : yield* this.#tablesNotOwnedBy(agentId);

      const result = yield* this.#send({ mode: "write", sql: checked.value, parameters, protectedTables });
      if (!result.ok) return { ok: false, message: result.message };
      if (change !== null) yield* this.#reconcileOwners(agentId);

      const { changes, lastInsertRowid } = result.value;
      return { ok: true, value: { changes, lastInsertRowid } };
    });
  }

  /** The agent-facing delete. Only the agent that created a table may remove it. */

  remove(agentId: string, name: string): Effect.Effect<AgentDatabaseCheck<string>, AgentTablesError> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<AgentDatabaseCheck<string>, AgentTablesError> {
      const table = yield* this.#find(name);
      if (!table.ok) return table;

      const owner = table.value.ownerAgentId;
      if (owner !== null && owner !== agentId) {
        return {
          ok: false,
          message: `${table.value.name} was created by another agent. Ask that agent to remove it, or the user can remove it in agent settings.`,
        };
      }
      return yield* this.#drop(agentId, table.value.name);
    });
  }

  /** The user's delete, from agent settings. Not owner-gated: the data is on their computer. */

  removeAsUser(name: string): Effect.Effect<void, AgentTablesError> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<void, AgentTablesError> {
      const table = yield* this.#find(name);
      if (!table.ok) return yield* new AgentTablesError({ message: table.message });
      const dropped = yield* this.#drop(null, table.value.name);
      if (!dropped.ok) return yield* new AgentTablesError({ message: dropped.message });
    });
  }

  dispose(): void {
    this.#supervisor.dispose();
  }

  #drop(agentId: string | null, name: string): Effect.Effect<AgentDatabaseCheck<string>, AgentTablesError> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<AgentDatabaseCheck<string>, AgentTablesError> {
      const result = yield* this.#send({ mode: "write", sql: `DROP TABLE "${quote(name)}"`, provision: true });
      if (!result.ok) return { ok: false, message: result.message };
      yield* this.#reconcileOwners(agentId);
      return { ok: true, value: name };
    });
  }

  #find(name: string): Effect.Effect<AgentDatabaseCheck<AgentTableSummary>, AgentTablesError> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<
      AgentDatabaseCheck<AgentTableSummary>,
      AgentTablesError
    > {
      const wanted = name.trim().toLowerCase();
      const table = (yield* this.list()).find((entry) => entry.name.toLowerCase() === wanted);
      if (!table) return { ok: false, message: `There is no table called ${name}.` };
      return { ok: true, value: table };
    });
  }

  #prepare(sql: string, mode: "read" | "write"): Effect.Effect<AgentDatabaseCheck<string>, AgentTablesError> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<AgentDatabaseCheck<string>, AgentTablesError> {
      const ready = yield* this.#ensure();
      if (!ready.ok) return ready;
      return checkAgentSql(sql, mode);
    });
  }

  /**
   * The file and the owner record, made once per run.
   *
   * The result is remembered rather than the promise being re-created, so a hundred statements in
   * one turn do not each pay a `mkdir` and a `CREATE TABLE IF NOT EXISTS`.
   */
  #ensure(): Effect.Effect<AgentDatabaseCheck<true>, AgentTablesError> {
    return Effect.gen({ self: this }, function* () {
      this.#ready ??= yield* Effect.cached(this.#provision());
      return yield* this.#ready;
    });
  }

  #provision(): Effect.Effect<AgentDatabaseCheck<true>, AgentTablesError> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<AgentDatabaseCheck<true>, AgentTablesError> {
      yield* tableIO(() => mkdir(this.#directory, { recursive: true, mode: 0o700 }));
      const created = yield* this.#send({
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
      yield* tableIO(() => chmod(this.#path, 0o600)).pipe(Effect.catch(() => Effect.void));
      return { ok: true, value: true };
    });
  }

  /**
   * Brings the owner record back in step with the tables that exist.
   *
   * SQLite itself is what decides a `CREATE TABLE` or `DROP TABLE` worked, so the record follows the
   * schema rather than the SQL: a table that appeared belongs to the agent that ran the statement,
   * and a row for a table that is gone is removed. Both statements are ours, so they run with
   * `provision` set -- nothing an agent writes can reach this table.
   */
  #reconcileOwners(agentId: string | null): Effect.Effect<void, AgentTablesError> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<void, AgentTablesError> {
      yield* this.#send({
        mode: "write",
        provision: true,
        sql: `DELETE FROM ${AGENT_DATABASE_METADATA_TABLE} WHERE table_name NOT IN (SELECT name FROM sqlite_master WHERE type = 'table')`,
      });
      if (agentId === null) return;
      yield* this.#send({
        mode: "write",
        provision: true,
        sql: `INSERT OR IGNORE INTO ${AGENT_DATABASE_METADATA_TABLE} (table_name, owner_agent_id, created_at) SELECT name, ?, ? FROM sqlite_master WHERE type = 'table' AND ${HIDDEN_TABLES}`,
        parameters: [agentId, new Date().toISOString()],
      });
    });
  }

  /**
   * The cap is on the whole store now that there is one file, so it is counted in tables rather
   * than in databases. It is a guard against a loop that makes a table per row, not a budget.
   */
  #roomForOneMore(): Effect.Effect<AgentDatabaseCheck<true>, AgentTablesError> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<AgentDatabaseCheck<true>, AgentTablesError> {
      const existing = yield* this.#send({
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
    });
  }

  #owners(): Effect.Effect<Map<string, string>, AgentTablesError> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<Map<string, string>, AgentTablesError> {
      const result = yield* this.#send({
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
    });
  }

  #tablesNotOwnedBy(agentId: string): Effect.Effect<string[], AgentTablesError> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<string[], AgentTablesError> {
      const owners = yield* this.#owners();
      return [...owners].filter(([, owner]) => owner !== agentId).map(([table]) => table);
    });
  }

  /**
   * Every table's count in one statement. An N+1 of counts would each pay their own deadline, and a
   * table too large to count inside one reports no count rather than failing the whole listing.
   */
  #rowCounts(names: string[]): Effect.Effect<Map<string, number>, AgentTablesError> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<Map<string, number>, AgentTablesError> {
      if (names.length === 0) return new Map();
      const sql = names
        .map((name) => `SELECT ? AS name, COUNT(*) AS row_count FROM "${quote(name)}"`)
        .join(" UNION ALL ");
      const result = yield* this.#send({ mode: "read", sql, parameters: names });
      if (!result.ok) return new Map();
      const counts = new Map<string, number>();
      for (const row of result.value.rows) {
        if (typeof row[0] === "string" && typeof row[1] === "number") counts.set(row[0], row[1]);
      }
      return counts;
    });
  }

  #send(request: {
    mode: "read" | "write";
    sql: string;
    parameters?: AgentDatabaseParameter[];
    protectedTables?: string[];
    provision?: boolean;
  }): Effect.Effect<AgentDatabaseCheck<AgentDatabaseRows>, AgentTablesError> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<
      AgentDatabaseCheck<AgentDatabaseRows>,
      AgentTablesError
    > {
      const outcome = yield* this.#supervisor.send({
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
    });
  }
}

/** Escapes an identifier for the one place a table name is written into SQL rather than bound. */
function quote(name: string): string {
  return name.replaceAll('"', '""');
}

class AgentTablesError extends Schema.TaggedError<AgentTablesError>()("AgentTablesError", { message: Schema.String }) {}

function tableIO<A>(operation: () => Promise<A>): Effect.Effect<A, AgentTablesError> {
  return Effect.tryPromise({
    try: operation,
    catch: (error) => new AgentTablesError({ message: error instanceof Error ? error.message : String(error) }),
  });
}
