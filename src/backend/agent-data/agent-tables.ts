import { access, chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { SharedTable } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Schema, Semaphore } from "effect";
import {
  AGENT_DATABASE_LIMITS,
  AGENT_DATABASE_METADATA_TABLE,
  type AgentDatabaseParameter,
  type AgentDatabaseRows,
  type AgentDatabaseStatement,
  type AgentDatabaseValue,
} from "./agent-database-protocol";
import { type AgentDatabaseCheck, type AgentSchemaChange, checkAgentSql, schemaChange } from "./agent-database-rules";
import type { AgentDatabaseSupervisor } from "./agent-database-supervisor";

export interface AgentTablesOptions {
  sharedRoot: string;
  supervisor: AgentDatabaseSupervisor;
}

export interface AgentTableSummary {
  name: string;
  ownerAgentId: string | null;
  rowCount: number | null;
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

const HIDDEN_TABLES = `name NOT LIKE 'sqlite~_%' ESCAPE '~' AND name <> '${AGENT_DATABASE_METADATA_TABLE}'`;

export class AgentTables {
  readonly #directory: string;
  readonly #path: string;
  readonly #supervisor: AgentDatabaseSupervisor;
  readonly #schemaLock = Semaphore.makeUnsafe(1);
  #ready: Effect.Effect<AgentDatabaseCheck<true>, AgentTablesError> | null = null;

  constructor(options: AgentTablesOptions) {
    this.#directory = join(options.sharedRoot, DIRECTORY);
    this.#path = join(this.#directory, FILE_NAME);
    this.#supervisor = options.supervisor;
  }

  list(): Effect.Effect<AgentDatabaseCheck<AgentTableSummary[]>, AgentTablesError> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<
      AgentDatabaseCheck<AgentTableSummary[]>,
      AgentTablesError
    > {
      const ready = yield* this.#ensure();
      if (!ready.ok) return ready;

      const schema = yield* this.#send({
        mode: "read",
        sql: `SELECT name, sql FROM sqlite_master WHERE type = 'table' AND ${HIDDEN_TABLES} ORDER BY name`,
      });
      if (!schema.ok) return schema;

      const names = schema.value.rows.map((row) => String(row[0]));
      const [owners, counts] = yield* Effect.all([this.#owners(), this.#rowCounts(names)], {
        concurrency: "unbounded",
      });
      return {
        ok: true,
        value: schema.value.rows.map((row) => {
          const name = String(row[0]);
          return {
            name,
            ownerAgentId: owners.get(name) ?? null,
            rowCount: counts.get(name) ?? null,
            sql: row[1] === null ? "" : String(row[1]),
          };
        }),
      };
    });
  }

  listShared(): Effect.Effect<SharedTable[], AgentTablesError> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<SharedTable[], AgentTablesError> {
      const tables = yield* this.list();
      if (!tables.ok)
        return yield* new AgentTablesError({ message: sourceText("error.backend.sharedDataUnavailable") });
      return tables.value.map(({ name, ownerAgentId, rowCount }) => ({ name, ownerAgentId, rowCount }));
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
      if (change === null) return yield* this.#write(checked.value, parameters, []);
      return yield* this.#schemaLock.withPermit(this.#changeSchema(agentId, change, checked.value, parameters));
    });
  }

  remove(agentId: string, name: string): Effect.Effect<AgentDatabaseCheck<string>, AgentTablesError> {
    const remove = Effect.gen({ self: this }, function* (): Effect.fn.Return<
      AgentDatabaseCheck<string>,
      AgentTablesError
    > {
      const table = yield* this.#find(name);
      if (!table.ok) return table;

      const owner = table.value.ownerAgentId;
      if (owner !== null && owner !== agentId) {
        return {
          ok: false,
          message: `${table.value.name} was created by another agent. Ask that agent to remove it, or the user can remove it in agent settings.`,
        };
      }
      return yield* this.#drop(table.value.name);
    });
    return this.#schemaLock.withPermit(remove);
  }

  removeAsUser(name: string): Effect.Effect<void, AgentTablesError> {
    const remove = Effect.gen({ self: this }, function* (): Effect.fn.Return<void, AgentTablesError> {
      const table = yield* this.#find(name);
      if (!table.ok) return yield* new AgentTablesError({ message: table.message });
      const dropped = yield* this.#drop(table.value.name);
      if (!dropped.ok) return yield* new AgentTablesError({ message: dropped.message });
    });
    return this.#schemaLock.withPermit(remove);
  }

  prewarm(): Effect.Effect<void> {
    return Effect.tryPromise(() => access(this.#path)).pipe(
      Effect.andThen(Effect.try(() => this.#supervisor.prewarm())),
      Effect.ignore,
    );
  }

  dispose(): void {
    this.#supervisor.dispose();
  }

  #changeSchema(
    agentId: string,
    change: AgentSchemaChange,
    sql: string,
    parameters: AgentDatabaseParameter[],
  ): Effect.Effect<AgentDatabaseCheck<AgentDatabaseWriteResult>, AgentTablesError> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<
      AgentDatabaseCheck<AgentDatabaseWriteResult>,
      AgentTablesError
    > {
      const existing = yield* this.#tableNames();
      if (!existing.ok) return existing;
      if (change === "create" && existing.value.length >= INPUT_LIMITS.sharedTables) {
        return {
          ok: false,
          message: `There are already ${INPUT_LIMITS.sharedTables} tables. Add columns or rows to a table that exists, or remove one you created.`,
        };
      }
      const protectedTables = yield* this.#tablesNotOwnedBy(agentId);
      return yield* Effect.uninterruptible(
        Effect.gen({ self: this }, function* (): Effect.fn.Return<
          AgentDatabaseCheck<AgentDatabaseWriteResult>,
          AgentTablesError
        > {
          const result = yield* this.#write(sql, parameters, protectedTables);
          if (!result.ok) return result;
          yield* this.#forgetRemovedTables();
          yield* this.#claimNewTables(agentId, existing.value);
          return result;
        }),
      );
    });
  }

  #write(
    sql: string,
    parameters: AgentDatabaseParameter[],
    protectedTables: string[],
  ): Effect.Effect<AgentDatabaseCheck<AgentDatabaseWriteResult>, AgentTablesError> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<
      AgentDatabaseCheck<AgentDatabaseWriteResult>,
      AgentTablesError
    > {
      const result = yield* this.#send({ mode: "write", sql, parameters, protectedTables });
      if (!result.ok) return { ok: false, message: result.message };
      const { changes, lastInsertRowid } = result.value;
      return { ok: true, value: { changes, lastInsertRowid } };
    });
  }

  #drop(name: string): Effect.Effect<AgentDatabaseCheck<string>, AgentTablesError> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<AgentDatabaseCheck<string>, AgentTablesError> {
      const result = yield* this.#send({ mode: "write", sql: `DROP TABLE "${quote(name)}"`, provision: true });
      if (!result.ok) return { ok: false, message: result.message };
      yield* this.#forgetRemovedTables();
      return { ok: true, value: name };
    });
  }

  #find(name: string): Effect.Effect<AgentDatabaseCheck<AgentTableSummary>, AgentTablesError> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<
      AgentDatabaseCheck<AgentTableSummary>,
      AgentTablesError
    > {
      const wanted = name.trim().toLowerCase();
      const tables = yield* this.list();
      if (!tables.ok) return tables;
      const table = tables.value.find((entry) => entry.name.toLowerCase() === wanted);
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
        this.#ready = null;
        return { ok: false, message: created.message };
      }
      yield* tableIO(() => chmod(this.#path, 0o600)).pipe(Effect.catch(() => Effect.void));
      return { ok: true, value: true };
    });
  }

  #forgetRemovedTables(): Effect.Effect<void, AgentTablesError> {
    return Effect.asVoid(
      this.#send({
        mode: "write",
        provision: true,
        sql: `DELETE FROM ${AGENT_DATABASE_METADATA_TABLE} WHERE table_name NOT IN (SELECT name FROM sqlite_master WHERE type = 'table')`,
      }),
    );
  }

  #claimNewTables(agentId: string, existing: string[]): Effect.Effect<void, AgentTablesError> {
    return Effect.asVoid(
      this.#send({
        mode: "write",
        provision: true,
        sql: `INSERT OR IGNORE INTO ${AGENT_DATABASE_METADATA_TABLE} (table_name, owner_agent_id, created_at) SELECT name, ?, ? FROM sqlite_master WHERE type = 'table' AND ${HIDDEN_TABLES} AND name NOT IN (SELECT value FROM json_each(?))`,
        parameters: [agentId, new Date().toISOString(), JSON.stringify(existing)],
      }),
    );
  }

  #tableNames(): Effect.Effect<AgentDatabaseCheck<string[]>, AgentTablesError> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<AgentDatabaseCheck<string[]>, AgentTablesError> {
      const result = yield* this.#send({
        mode: "read",
        sql: `SELECT name FROM sqlite_master WHERE type = 'table' AND ${HIDDEN_TABLES}`,
      });
      if (!result.ok) return { ok: false, message: result.message };
      return { ok: true, value: result.value.rows.map((row) => String(row[0])) };
    });
  }

  #owners(): Effect.Effect<Map<string, string>, AgentTablesError> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<Map<string, string>, AgentTablesError> {
      const result = yield* this.#send({
        mode: "read",
        sql: `SELECT table_name, owner_agent_id FROM ${AGENT_DATABASE_METADATA_TABLE}`,
      });
      const owners = new Map<string, string>();
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
      const statement: Omit<AgentDatabaseStatement, "id"> = {
        kind: "statement",
        databasePath: this.#path,
        mode: request.mode,
        provision: request.provision ?? false,
        protectedTables: request.protectedTables ?? [],
        sql: request.sql,
        parameters: request.parameters ?? [],
        limits: AGENT_DATABASE_LIMITS,
      };
      let outcome = yield* this.#supervisor.send(statement);
      if (!outcome.ok && outcome.failure.kind === "missing" && !statement.provision) {
        this.#ready = null;
        const ready = yield* this.#ensure();
        if (!ready.ok) return ready;
        outcome = yield* this.#supervisor.send(statement);
      }
      return outcome.ok ? { ok: true, value: outcome.result } : { ok: false, message: outcome.failure.message };
    });
  }
}

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
