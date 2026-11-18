// The shared migration test harness. Tests only: no product code imports it.
//
// It builds a database at any shipped schema, puts representative rows in every table, upgrades it, and
// says what the upgrade must keep. `released-schema-upgrade-migration.test.ts` runs it from every shipped
// release; `openbot-database-schema-parity.test.ts` and `scripts/migration-large-db-e2e.ts` use its parts.
//
// The released schemas come from the release tags (`scripts/released-schema-fixtures.ts` writes
// `released-schemas/releases.json`), not from this build. A migration that changes rows adds a function
// to `ROW_CHANGES` below that makes the same change on the rows that the test reads before the upgrade.
// See "Database migrations" in `src/backend/AGENTS.md`.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from "node:sqlite";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { Schema } from "effect";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

/** The applied time of every harness migration, so that two runs make the same rows. */
export const HARNESS_APPLIED_AT = "2026-11-01T09:00:00.000Z";

// Each list is a change of the same list in the entry before: `[start, end]` stands for its items
// `start` to `end - 1` (`scripts/released-schema-fixtures.ts`).
const Changes = <Item extends Schema.Constraint>(item: Item) =>
  Schema.Array(Schema.Union([item, Schema.Tuple([Schema.Number, Schema.Number])]));
const ReleasedSchema = Schema.Struct({ migrations: Changes(Schema.Number), objects: Changes(Schema.String) });

const ReleasedSchemas = Schema.Struct({
  releases: Schema.Array(
    Schema.Struct({ tag: Schema.String, newInstall: ReleasedSchema, upgraded: Schema.optional(ReleasedSchema) }),
  ),
  statements: Schema.Record(Schema.String, Schema.String),
});

function applyChanges<Item extends number | string>(
  base: readonly Item[],
  changes: readonly (Item | readonly [number, number])[],
): Item[] {
  return changes.flatMap((change) => (typeof change === "object" ? base.slice(change[0], change[1]) : [change]));
}

export interface ReleasedDatabaseCase {
  /** For example "v0.3.0 new install (schema 10)". */
  readonly name: string;
  /** The `schema_migrations` versions that the release wrote. */
  readonly migrations: readonly number[];
  /** The statements that make the schema, in the order that SQLite stores them. */
  readonly statements: readonly string[];
}

/**
 * Two databases for each release that changed them: the database of a new install, and the database of
 * an install that upgraded through every release from v0.1.12.
 */
export function releasedDatabaseCases(): readonly ReleasedDatabaseCase[] {
  const file = Schema.decodeUnknownSync(ReleasedSchemas)(
    JSON.parse(readFileSync(join(import.meta.dirname, "released-schemas", "releases.json"), "utf8")),
  );
  const statement = (hash: string): string => {
    const sql = file.statements[hash];
    if (sql === undefined) throw new Error(`releases.json has no statement ${hash}.`);
    return sql;
  };
  const empty = { migrations: [], objects: [] };
  let previous: Record<"newInstall" | "upgraded", { migrations: number[]; objects: string[] }> = {
    newInstall: empty,
    upgraded: empty,
  };
  return file.releases.flatMap((release) => {
    const read = (kind: "newInstall" | "upgraded", changes: typeof release.newInstall) => ({
      migrations: applyChanges(previous[kind].migrations, changes.migrations),
      objects: applyChanges(previous[kind].objects, changes.objects),
    });
    const newInstall = read("newInstall", release.newInstall);
    const upgraded = release.upgraded ? read("upgraded", release.upgraded) : null;
    previous = { newInstall, upgraded: upgraded ?? newInstall };
    const kinds = [
      ["new install", newInstall],
      ...(upgraded ? [["upgraded through every release", upgraded] as const] : []),
    ] as const;
    return kinds.map(([kind, schema]) => ({
      name: `${release.tag} ${kind} (schema ${schema.migrations.at(-1)})`,
      migrations: schema.migrations,
      statements: schema.objects.map(statement),
    }));
  });
}

/** Opens a database with the settings of `database-core.ts` that a migration can see. */
export function openHarnessDatabase(path = ":memory:"): DatabaseSync {
  const db = new DatabaseSync(path);
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA synchronous = NORMAL");
  return db;
}

/** Makes the database that a release made, with no rows except its `schema_migrations` versions. */
export function buildReleasedDatabase(db: DatabaseSync, released: ReleasedDatabaseCase): void {
  for (const sql of released.statements) db.exec(sql);
  const hasAppliedAt = query(db, "PRAGMA table_info(schema_migrations)").some((row) => row.name === "applied_at");
  const insert = db.prepare(
    hasAppliedAt
      ? "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)"
      : "INSERT INTO schema_migrations (version) VALUES (?)",
  );
  for (const version of released.migrations) {
    if (hasAppliedAt) insert.run(version, HARNESS_APPLIED_AT);
    else insert.run(version);
  }
}

/**
 * Makes an upgraded database at `version` with the migrations of this build. A real database at that
 * version has the same schema, because a shipped migration does not change (the history test).
 */
export function buildDatabaseAtVersion(db: DatabaseSync, version: number): void {
  db.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  migrateOpenBotDatabase(db, { appliedAt: HARNESS_APPLIED_AT, throughVersion: version });
}

export function latestAppliedVersion(db: DatabaseSync): number {
  return readAppliedVersions(db).at(-1) ?? 0;
}

// ---------------------------------------------------------------------------------------------------
// Rows

/** Each user table, with its columns and rows in storage order. */
export type TableRows = Map<string, { readonly columns: readonly string[]; rows: Record<string, SQLOutputValue>[] }>;

/**
 * Values that make a migration do its work. Each one sets only columns that the table has. The other
 * columns get generic values: an enum value from the CHECK list, JSON for a JSON column, a time for a
 * `*_at` column, the parent row's key for a foreign key, NULL in the first row for a nullable column.
 */
const ROW_VALUES: Record<string, { readonly count: number; readonly values: (row: number) => DynamicRecord }> = {
  // Migration 39 deletes event 0, because event 1 of the same thread repeats it. Migration 8 keeps the
  // last snapshot of each thread and the last mailbox event.
  orchestration_events: {
    count: 4,
    values: (row) => {
      const reconciled = { changedMessages: [{ id: "message_id-0", text: '界 "quoted" \\ end' }] };
      const events: readonly DynamicRecord[] = [
        { event_type: "conversation.mailbox-reconciled", payload_json: JSON.stringify(reconciled) },
        { event_type: "conversation.mailbox-reconciled", payload_json: JSON.stringify(reconciled) },
        { event_type: "conversation.snapshot-updated", payload_json: JSON.stringify({ snapshot: { messages: [] } }) },
        { aggregate_type: "mailbox", aggregate_id: "mailbox", event_type: "mailbox.updated" },
      ];
      return { aggregate_type: "thread", aggregate_id: "thread_id-0", ...events[row] };
    },
  },
  // A receipt for each event's command, so that only the receipt of a deleted event is an orphan.
  orchestration_command_receipts: {
    count: 4,
    values: (row) => ({ first_sequence: row + 1, last_sequence: row + 1 }),
  },
  // The activity of event 0, which migration 39 deletes with it.
  projection_thread_activities: {
    count: 2,
    values: (row) => (row === 0 ? { activity_type: "conversation.mailbox-reconciled", last_event_sequence: 1 } : {}),
  },
  // Migrations 9, 10, 11 and 14 end each active provider session.
  projection_provider_sessions: { count: 2, values: (row) => (row === 0 ? { state: "active" } : {}) },
  // Migration 21 renames a server that has the name of Computer Use.
  projection_mcp_servers: { count: 2, values: (row) => (row === 0 ? { name: "Computer_Use" } : {}) },
  // One proxy of each kind; a CHECK ties each kind to its columns.
  browser_proxies: {
    count: 2,
    values: (row) =>
      row === 0
        ? { kind: "address", scheme: "socks5", host: "proxy.example", port: 1080, member_id: null }
        : { kind: "computer", scheme: null, host: null, port: null, username: null, password: null },
  },
  // An edge joins two nodes of one workflow, so both nodes are in the first workflow.
  workflow_nodes: { count: 2, values: () => ({ workflow_id: "workflow_id-0" }) },
  // Each kind has one source, and Stripe is the only kind.
  crm_sources: { count: 1, values: () => ({}) },
};

/** Puts rows in every user table. Throws with the table name when a table takes no row. */
export function seedEveryTable(db: DatabaseSync): void {
  const tables = userTables(db);
  for (const table of foreignKeyOrder(db, tables)) {
    // A trigger can fill a table (a memory adds its selection). Those rows are representative already.
    if (count(query(db, `SELECT COUNT(*) AS n FROM ${quote(table)}`)[0] ?? {}, "n") > 0) continue;
    seedTable(db, table);
  }
}

interface ColumnInfo {
  readonly name: string;
  readonly type: string;
  readonly notNull: boolean;
}

function seedTable(db: DatabaseSync, table: string): void {
  const columns: ColumnInfo[] = query(db, `PRAGMA table_xinfo(${quote(table)})`)
    .filter((row) => count(row, "hidden") === 0)
    .map((row) => ({
      name: text(row, "name"),
      type: text(row, "type").toUpperCase(),
      // SQLite lets a TEXT primary key hold NULL; a key column gets a value, as it does in the app.
      notNull: count(row, "notnull") === 1 || count(row, "pk") > 0,
    }));
  const constraints = readColumnConstraints(tableSql(db, table));
  const foreignKeys = readForeignKeys(db, table);
  const special = ROW_VALUES[table];
  const insert = db.prepare(
    `INSERT INTO ${quote(table)} (${columns.map((column) => quote(column.name)).join(", ")})
     VALUES (${columns.map(() => "?").join(", ")})`,
  );

  for (let row = 0; row < (special?.count ?? 2); row += 1) {
    const errors: string[] = [];
    let inserted = false;
    for (const nulls of ["first row", "never", "always"] as const) {
      for (let enumShift = 0; enumShift < 4 && !inserted; enumShift += 1) {
        const values: Record<string, SQLInputValue> = {};
        for (const column of columns) {
          const useNull = !column.notNull && (nulls === "always" || (nulls === "first row" && row === 0));
          values[column.name] = useNull ? null : genericValue(column, row, enumShift, constraints.get(column.name));
        }
        // Two keys to the same table (an edge from one node to another) take different parent rows.
        const seen = new Map<string, number>();
        const filled = new Set<string>();
        for (const foreignKey of foreignKeys) {
          const offset = seen.get(foreignKey.parent) ?? 0;
          seen.set(foreignKey.parent, offset + 1);
          fillForeignKey(db, table, foreignKey, values, columns, row + offset, filled);
          for (const column of foreignKey.from) filled.add(column);
        }
        const specialValues = special?.values(row) ?? {};
        for (const column of columns) {
          const value = specialValues[column.name];
          if (isString(value) || isNumber(value) || value === null) values[column.name] = value;
        }
        try {
          insert.run(...columns.map((column) => values[column.name] ?? null));
          inserted = true;
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
      if (inserted) break;
    }
    if (!inserted) {
      throw new Error(`The harness could not seed ${table} row ${row}: ${[...new Set(errors)].join("; ")}`);
    }
  }
}

interface ColumnConstraint {
  enumValues?: readonly SQLInputValue[];
  exactLength?: number;
  maxLength?: number;
  json?: boolean;
}

const IDENTIFIER = String.raw`["\x60[]?(\w+)["\x60\]]?`;
const LITERAL = String.raw`(?:'(?:[^']|'')*'|-?\d+)`;

// Reads the CHECK rules that a generic value must meet. The patterns cover the rules of every shipped
// schema; a new rule that they miss makes `seedTable` throw, and the fix is a pattern here or a value
// in ROW_VALUES.
function readColumnConstraints(sql: string): Map<string, ColumnConstraint> {
  const constraints = new Map<string, ColumnConstraint>();
  const of = (name: string): ColumnConstraint => {
    const found = constraints.get(name) ?? {};
    constraints.set(name, found);
    return found;
  };
  const enumPattern = new RegExp(
    String.raw`(?<!NOT\s)${IDENTIFIER}\s+IN\s*\(\s*(${LITERAL}(?:\s*,\s*${LITERAL})*)\s*\)`,
    "giu",
  );
  for (const match of sql.matchAll(enumPattern)) {
    const [, name = "", list = ""] = match;
    const constraint = of(name);
    constraint.enumValues ??= [...list.matchAll(new RegExp(LITERAL, "gu"))].map(([literal]) =>
      literal.startsWith("'") ? literal.slice(1, -1).replaceAll("''", "'") : Number(literal),
    );
  }
  for (const [, name = "", length = ""] of sql.matchAll(
    new RegExp(String.raw`length\(\s*${IDENTIFIER}\s*\)\s*=\s*(\d+)`, "giu"),
  )) {
    of(name).exactLength = Number(length);
  }
  const maxPatterns = [
    String.raw`length\(\s*${IDENTIFIER}\s*\)\s*BETWEEN\s*\d+\s*AND\s*(\d+)`,
    String.raw`length\(\s*${IDENTIFIER}\s*\)\s*<=\s*(\d+)`,
  ];
  for (const pattern of maxPatterns) {
    for (const [, name = "", length = ""] of sql.matchAll(new RegExp(pattern, "giu")))
      of(name).maxLength = Number(length);
  }
  for (const [, name = ""] of sql.matchAll(new RegExp(String.raw`json_valid\(\s*${IDENTIFIER}\s*\)`, "giu"))) {
    of(name).json = true;
  }
  return constraints;
}

const READABLE_TEXT = /(^|_)(text|title|body|content|summary|description|notes|prompt)$/u;

function genericValue(
  column: ColumnInfo,
  row: number,
  enumShift: number,
  constraint: ColumnConstraint | undefined,
): SQLInputValue {
  const { name, type } = column;
  if (constraint?.enumValues?.length) {
    return constraint.enumValues[(row + enumShift) % constraint.enumValues.length] ?? null;
  }
  if (type.includes("INT")) return row + 1;
  if (/REAL|FLOA|DOUB/u.test(type)) return row + 0.5;
  if (type.includes("BLOB")) return new Uint8Array([row, 0xff, 0x00]);
  if (constraint?.json || name.endsWith("_json")) {
    return JSON.stringify({ seed: `${name}-${row}`, text: '界 "quoted" \\ end', nested: { row } });
  }
  if (name.endsWith("_on")) return `2026-0${row + 1}-15`;
  if (name === "currency") return ["EUR", "USD", "PLN"][row % 3] ?? "EUR";
  if (/_(at|until|for)$/u.test(name)) return `2026-0${row + 1}-15T08:0${row}:00.000Z`;
  const base = READABLE_TEXT.test(name) ? `${name}-${row} 界 "quoted" 'single'` : `${name}-${row}`;
  if (constraint?.exactLength !== undefined) return fitLength(name, row, constraint.exactLength, true);
  if (constraint?.maxLength !== undefined && base.length > constraint.maxLength) {
    return fitLength(name, row, constraint.maxLength, false);
  }
  return base;
}

// Keeps the row number, so that each row stays unique.
function fitLength(name: string, row: number, length: number, exact: boolean): string {
  const suffix = `-${row}`;
  const value = `${name.slice(0, Math.max(0, length - suffix.length))}${suffix}`.slice(-length);
  return exact ? value.padStart(length, "x") : value;
}

interface ForeignKey {
  readonly parent: string;
  readonly from: readonly string[];
  readonly to: readonly (string | null)[];
}

function readForeignKeys(db: DatabaseSync, table: string): readonly ForeignKey[] {
  const byId = new Map<number, { parent: string; from: string[]; to: (string | null)[] }>();
  for (const row of query(db, `PRAGMA foreign_key_list(${quote(table)})`)) {
    const id = count(row, "id");
    const key = byId.get(id) ?? { parent: text(row, "table"), from: [], to: [] };
    key.from.push(text(row, "from"));
    key.to.push(optionalText(row, "to"));
    byId.set(id, key);
  }
  return [...byId.values()];
}

function fillForeignKey(
  db: DatabaseSync,
  table: string,
  foreignKey: ForeignKey,
  values: Record<string, SQLInputValue>,
  columns: readonly ColumnInfo[],
  row: number,
  filled: ReadonlySet<string>,
): void {
  // A row with a NULL in a key column refers to nothing.
  if (foreignKey.from.some((column) => values[column] === null)) return;
  const parentColumns = foreignKey.to.some((column) => column === null)
    ? primaryKeyColumns(db, foreignKey.parent)
    : foreignKey.to.filter(isString);
  if (foreignKey.parent === table) {
    // A row can refer to itself; NULL is the plain case where the column takes it.
    const nullable = foreignKey.from.every((column) => !columns.find((info) => info.name === column)?.notNull);
    foreignKey.from.forEach((column, index) => {
      values[column] = nullable ? null : (values[parentColumns[index] ?? ""] ?? null);
    });
    return;
  }
  const parents = query(
    db,
    `SELECT ${parentColumns.map(quote).join(", ")} FROM ${quote(foreignKey.parent)} ORDER BY rowid`,
  );
  // A column that an earlier key set (the workflow of both nodes of an edge) limits the parent rows.
  const matching = parents.filter((candidate) =>
    foreignKey.from.every(
      (column, index) => !filled.has(column) || candidate[parentColumns[index] ?? ""] === values[column],
    ),
  );
  const parent = matching[row % Math.max(1, matching.length)];
  foreignKey.from.forEach((column, index) => {
    const value = parent?.[parentColumns[index] ?? ""];
    values[column] = isString(value) || isNumber(value) ? value : null;
  });
}

function primaryKeyColumns(db: DatabaseSync, table: string): readonly string[] {
  return query(db, `PRAGMA table_info(${quote(table)})`)
    .filter((row) => count(row, "pk") > 0)
    .sort((left, right) => count(left, "pk") - count(right, "pk"))
    .map((row) => text(row, "name"));
}

function foreignKeyOrder(db: DatabaseSync, tables: readonly string[]): readonly string[] {
  const known = new Set(tables);
  const ordered: string[] = [];
  const visiting = new Set<string>();
  const visit = (table: string): void => {
    if (ordered.includes(table) || visiting.has(table)) return;
    visiting.add(table);
    for (const key of readForeignKeys(db, table)) if (key.parent !== table && known.has(key.parent)) visit(key.parent);
    visiting.delete(table);
    ordered.push(table);
  };
  for (const table of tables) visit(table);
  return ordered;
}

/** The tables that hold user data: not `schema_migrations`, not a full-text index or its shadow tables. */
function userTables(db: DatabaseSync): readonly string[] {
  return query(
    db,
    `SELECT list.name FROM pragma_table_list AS list
     JOIN sqlite_master AS master ON master.name = list.name AND master.type = 'table'
     WHERE list.schema = 'main' AND list.type = 'table' AND list.name NOT LIKE 'sqlite_%'
       AND list.name != 'schema_migrations' AND master.sql NOT LIKE 'CREATE VIRTUAL TABLE%'
     ORDER BY list.name`,
  ).map((row) => text(row, "name"));
}

function tableSql(db: DatabaseSync, table: string): string {
  const row = query(db, "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", table)[0];
  return row ? text(row, "sql") : "";
}

/** Every row of every user table, in storage order. */
export function readTableRows(db: DatabaseSync): TableRows {
  const tables: TableRows = new Map();
  for (const table of userTables(db)) {
    const columns = query(db, `PRAGMA table_xinfo(${quote(table)})`)
      .filter((row) => count(row, "hidden") === 0)
      .map((row) => text(row, "name"));
    tables.set(table, { columns, rows: readRows(db, table, columns) });
  }
  return tables;
}

function readRows(db: DatabaseSync, table: string, columns: readonly string[]): Record<string, SQLOutputValue>[] {
  return db
    .prepare(`SELECT ${columns.map(quote).join(", ")} FROM ${quote(table)}`)
    .all()
    .map((row) => Object.fromEntries(columns.map((column) => [column, row[column] ?? null])));
}

// ---------------------------------------------------------------------------------------------------
// What an upgrade must do to the rows

interface RowChangeContext {
  readonly appliedAt: string;
  /** Tables whose rows the migration changes in a way that this harness does not model. */
  readonly unchecked: Set<string>;
}

type RowChange = (tables: TableRows, context: RowChangeContext) => void;

const RECONCILED = "conversation.mailbox-reconciled";

function endActiveProviderSessions(tables: TableRows, { appliedAt }: RowChangeContext): void {
  for (const row of tables.get("projection_provider_sessions")?.rows ?? []) {
    if (row.state === "active") Object.assign(row, { state: "inactive", updated_at: appliedAt });
  }
}

function deleteOrphanReceipts(tables: TableRows): void {
  const receipts = tables.get("orchestration_command_receipts");
  if (!receipts) return;
  const commands = new Set(tables.get("orchestration_events")?.rows.map((row) => row.command_id));
  receipts.rows = receipts.rows.filter((row) => commands.has(row.command_id));
}

/**
 * The change that each migration makes to existing rows, written from what the migration promises. A
 * migration that only adds tables, columns or indexes needs no entry: the harness checks that every row
 * and value stays.
 */
const ROW_CHANGES: Record<number, RowChange> = {
  // The baseline compacts the event history and fills the read state. `pre-registry-schema-migration.test.ts`
  // checks those rows; here they are not compared. Old reactions become reactions of the user.
  8: (tables, { unchecked }) => {
    for (const table of [
      "orchestration_events",
      "orchestration_command_receipts",
      "projection_thread_activities",
      "projection_provider_sessions",
      "projection_thread_read_baselines",
      "projection_direct_reads",
    ]) {
      unchecked.add(table);
    }
    const reactions = tables.get("projection_reactions");
    if (reactions && !reactions.columns.includes("actor_kind")) {
      tables.set("projection_reactions", {
        columns: [...reactions.columns, "actor_kind", "actor_bot_id"],
        rows: reactions.rows.map((row) => ({ ...row, actor_kind: "user", actor_bot_id: "" })),
      });
    }
  },
  9: endActiveProviderSessions,
  10: endActiveProviderSessions,
  11: endActiveProviderSessions,
  12: (tables) => {
    const reactions = tables.get("projection_reactions");
    if (!reactions?.columns.includes("actor_bot_id")) return;
    tables.set("projection_reactions", {
      columns: reactions.columns.map((column) => (column === "actor_bot_id" ? "actor_agent_id" : column)),
      rows: reactions.rows.map(({ actor_bot_id, ...row }) => ({
        ...row,
        actor_kind: row.actor_kind === "bot" ? "agent" : (row.actor_kind ?? null),
        actor_agent_id: actor_bot_id ?? null,
      })),
    });
  },
  // Renames generated `bot-` agent ids in every text column. The seeds have no such id, so no row changes;
  // `agent-workspace-root-migration.test.ts` covers the rename.
  13: (tables) => {
    const generated = tables.get("projection_agents")?.rows.filter((row) => String(row.agent_id).startsWith("bot-"));
    if (generated?.length) throw new Error("The harness does not model migration 13 for `bot-` agent ids.");
  },
  14: endActiveProviderSessions,
  21: (tables) => {
    const servers = tables.get("projection_mcp_servers")?.rows ?? [];
    const taken = new Set(servers.map((row) => String(row.name).toLowerCase()));
    for (const row of servers) {
      if (String(row.name).toLowerCase() !== "computer_use") continue;
      let name = "computer_use_saved";
      for (let suffix = 2; taken.has(name); suffix += 1) name = `computer_use_saved_${suffix}`;
      taken.add(name);
      row.name = name;
    }
  },
  // Deletes a reconcile event that the next event of its thread repeats, its activity and its receipt.
  39: (tables) => {
    const events = tables.get("orchestration_events");
    if (!events) return;
    const repeated = new Set<SQLOutputValue | undefined>();
    for (const event of events.rows) {
      if (event.aggregate_type !== "thread" || event.event_type !== RECONCILED) continue;
      const next = events.rows
        .filter(
          (later) =>
            later.aggregate_type === "thread" &&
            later.aggregate_id === event.aggregate_id &&
            Number(later.sequence) > Number(event.sequence),
        )
        .sort((left, right) => Number(left.sequence) - Number(right.sequence))[0];
      if (next?.event_type === event.event_type && next.payload_json === event.payload_json)
        repeated.add(event.sequence);
    }
    events.rows = events.rows.filter((row) => !repeated.has(row.sequence));
    const activities = tables.get("projection_thread_activities");
    if (activities) {
      activities.rows = activities.rows.filter(
        (row) => !(row.activity_type === RECONCILED && repeated.has(row.last_event_sequence)),
      );
    }
    deleteOrphanReceipts(tables);
  },
  // Each task whose thread exists becomes an archived side thread; the task table goes.
  47: (tables) => {
    const tasks = tables.get("projection_agent_tasks");
    tables.delete("projection_agent_tasks");
    const threads = new Set(tables.get("projection_threads")?.rows.map((row) => row.thread_id));
    tables.set("projection_agent_threads", {
      columns: [
        "thread_id",
        "agent_id",
        "legacy_task_id",
        "origin",
        "title",
        "title_source",
        "outcome",
        "error",
        "created_at",
        "updated_at",
        "archived_at",
        "last_event_sequence",
      ],
      rows: (tasks?.rows ?? [])
        .filter((task) => threads.has(task.thread_id))
        .map((task) => ({
          thread_id: task.thread_id ?? null,
          agent_id: task.agent_id ?? null,
          legacy_task_id: task.task_id ?? null,
          origin: task.origin ?? null,
          title: task.title ?? null,
          title_source: task.origin === "agent" ? "agent" : "auto",
          outcome: task.outcome ?? null,
          error: task.error ?? null,
          created_at: task.created_at ?? null,
          updated_at: task.updated_at ?? null,
          archived_at: task.closed_at ?? null,
          last_event_sequence: task.last_event_sequence ?? null,
        })),
    });
  },
};

export interface ExpectedRows {
  readonly tables: TableRows;
  readonly unchecked: ReadonlySet<string>;
  /** Tables that the upgrade must remove. */
  readonly dropped: readonly string[];
}

/** The rows that an upgrade from `fromVersion` to `toVersion` must leave, from the rows before it. */
export function expectedRowsAfterUpgrade(
  before: TableRows,
  fromVersion: number,
  toVersion: number,
  appliedAt = HARNESS_APPLIED_AT,
): ExpectedRows {
  const tables: TableRows = new Map(
    [...before].map(([table, { columns, rows }]) => [table, { columns, rows: rows.map((row) => ({ ...row })) }]),
  );
  const context: RowChangeContext = { appliedAt, unchecked: new Set() };
  // A database from before the registry (versions 3 to 6) runs the baseline, version 8.
  for (let version = Math.max(fromVersion + 1, 8); version <= toVersion; version += 1) {
    ROW_CHANGES[version]?.(tables, context);
  }
  return { tables, unchecked: context.unchecked, dropped: [...before.keys()].filter((table) => !tables.has(table)) };
}

/**
 * The rows of each checked table, sorted, read from `db` with the columns of `expected`. A test compares
 * it with `sortedRows(expected)`: the same value means every row and value is there.
 */
export function actualRows(db: DatabaseSync, expected: ExpectedRows): Record<string, readonly string[]> {
  const present = new Set(userTables(db));
  return Object.fromEntries(
    [...expected.tables]
      .filter(([table]) => !expected.unchecked.has(table))
      .map(([table, { columns }]) => [
        table,
        present.has(table) ? sortRows(readRows(db, table, columns), columns) : ["<table is missing>"],
      ]),
  );
}

export function sortedRows(expected: ExpectedRows): Record<string, readonly string[]> {
  return Object.fromEntries(
    [...expected.tables]
      .filter(([table]) => !expected.unchecked.has(table))
      .map(([table, { columns, rows }]) => [table, sortRows(rows, columns)]),
  );
}

function sortRows(rows: readonly Record<string, SQLOutputValue>[], columns: readonly string[]): readonly string[] {
  return rows
    .map((row) =>
      JSON.stringify(
        columns.map((column) => {
          const value = row[column] ?? null;
          return value instanceof Uint8Array ? `blob:${Buffer.from(value).toString("hex")}` : value;
        }),
      ),
    )
    .sort();
}

// ---------------------------------------------------------------------------------------------------
// Health and schema

/** The problems that `integrity_check`, `foreign_key_check` and the full-text index check find. */
export function healthProblems(db: DatabaseSync): readonly string[] {
  const problems = query(db, "PRAGMA integrity_check")
    .map((row) => text(row, "integrity_check"))
    .filter((message) => message !== "ok");
  for (const row of query(db, "PRAGMA foreign_key_check")) {
    problems.push(`foreign key: ${text(row, "table")} row ${optionalText(row, "rowid")} -> ${text(row, "parent")}`);
  }
  for (const row of query(db, "SELECT name FROM sqlite_master WHERE sql LIKE 'CREATE VIRTUAL TABLE%USING fts5%'")) {
    const table = text(row, "name");
    try {
      db.exec(`INSERT INTO ${quote(table)}(${quote(table)}) VALUES ('integrity-check')`);
    } catch (error) {
      problems.push(`${table}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return problems;
}

interface ColumnShape {
  readonly name: string;
  readonly type: string;
  readonly notNull: number;
  readonly default: string | null;
  readonly primaryKey: number;
}

interface IndexShape {
  readonly name: string;
  readonly unique: number;
  readonly origin: string;
  readonly partial: number;
  readonly columns: readonly { readonly name: string | null; readonly descending: number; readonly key: number }[];
}

interface ForeignKeyShape {
  readonly table: string;
  readonly from: string | null;
  readonly to: string | null;
  readonly onUpdate: string;
  readonly onDelete: string;
}

interface TableShape {
  readonly columns: readonly ColumnShape[];
  readonly indexes: readonly IndexShape[];
  readonly foreignKeys: readonly ForeignKeyShape[];
}

export function readTableShapes(database: DatabaseSync): Record<string, TableShape> {
  const shapes: Record<string, TableShape> = {};
  for (const table of readTableNames(database)) {
    shapes[table] = {
      columns: query(database, `PRAGMA table_info(${quote(table)})`).map((row) => ({
        name: text(row, "name"),
        type: text(row, "type"),
        notNull: count(row, "notnull"),
        default: optionalText(row, "dflt_value"),
        primaryKey: count(row, "pk"),
      })),
      indexes: query(database, `PRAGMA index_list(${quote(table)})`)
        .map((row) => ({
          name: text(row, "name"),
          unique: count(row, "unique"),
          origin: text(row, "origin"),
          partial: count(row, "partial"),
          columns: query(database, `PRAGMA index_xinfo(${quote(text(row, "name"))})`).map((column) => ({
            name: optionalText(column, "name"),
            descending: count(column, "desc"),
            key: count(column, "key"),
          })),
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      foreignKeys: query(database, `PRAGMA foreign_key_list(${quote(table)})`).map((row) => ({
        table: text(row, "table"),
        from: optionalText(row, "from"),
        to: optionalText(row, "to"),
        onUpdate: text(row, "on_update"),
        onDelete: text(row, "on_delete"),
      })),
    };
  }
  return shapes;
}

export interface Declaration {
  readonly type: string;
  readonly name: string;
  readonly table: string;
  readonly sql: readonly string[];
}

// The PRAGMAs above cannot express a partial index's WHERE clause or a CHECK
// constraint, so the declarations are compared too - normalized, because a
// migration that rewrites a table leaves SQLite's own rendering of the DDL
// behind rather than the text the schema was written with.
export function readNormalizedDeclarations(database: DatabaseSync): readonly Declaration[] {
  return query(
    database,
    `SELECT type, name, tbl_name, sql FROM sqlite_master
     WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations'
     ORDER BY type, name`,
  ).map((row) => ({
    type: text(row, "type"),
    name: text(row, "name"),
    table: text(row, "tbl_name"),
    sql: tokenizeSql(text(row, "sql")),
  }));
}

// SQLite stores a CREATE statement close to how it was written, so this text is
// as much a record of the author's formatting as of the schema. A new install of an
// older release declared a table from a different piece of source (its separate latest
// schema) than the migration that produced it, so comparing the text would go red on a
// space before a comma, `TEXT` against `text`, `x > 0` against `x>0` or a comment
// only one side carries, none of which any caller can observe. Comparing the
// token sequence instead drops formatting entirely and keeps what a caller can
// observe: the identifiers, keywords, operators and literals, in order.
//
// A string literal keeps its case, because a DEFAULT 'grok' is data rather than
// syntax, and IF NOT EXISTS is dropped because only one path writes it.
function tokenizeSql(sql: string): readonly string[] {
  const tokens: string[] = [];
  let index = 0;

  while (index < sql.length) {
    const character = sql[index] ?? "";

    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === "-" && sql[index + 1] === "-") {
      const newline = sql.indexOf("\n", index);
      index = newline === -1 ? sql.length : newline + 1;
      continue;
    }
    if (character === "/" && sql[index + 1] === "*") {
      const close = sql.indexOf("*/", index + 2);
      index = close === -1 ? sql.length : close + 2;
      continue;
    }
    if (character === "'") {
      const end = closingQuote(sql, index, "'");
      tokens.push(sql.slice(index, end));
      index = end;
      continue;
    }
    if (character === '"' || character === "`" || character === "[") {
      const closing = character === "[" ? "]" : character;
      const end = closingQuote(sql, index, closing);
      tokens.push(sql.slice(index + 1, end - 1).toUpperCase());
      index = end;
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(sql.slice(index));
    if (word) {
      tokens.push(word[0].toUpperCase());
      index += word[0].length;
      continue;
    }
    const number = /^\d+(\.\d+)?/.exec(sql.slice(index));
    if (number) {
      tokens.push(number[0]);
      index += number[0].length;
      continue;
    }
    const operator = TWO_CHARACTER_OPERATORS.find((candidate) => sql.startsWith(candidate, index));
    tokens.push(operator ?? character);
    index += operator?.length ?? 1;
  }

  return withoutIfNotExists(tokens);
}

const TWO_CHARACTER_OPERATORS = ["<=", ">=", "<>", "!=", "==", "||", "<<", ">>"];

const IF_NOT_EXISTS = ["IF", "NOT", "EXISTS"];

function withoutIfNotExists(tokens: readonly string[]): readonly string[] {
  const kept: string[] = [];
  for (const token of tokens) {
    kept.push(token);
    if (kept.slice(-IF_NOT_EXISTS.length).join(" ") === IF_NOT_EXISTS.join(" ")) kept.length -= IF_NOT_EXISTS.length;
  }
  return kept;
}

// A quoted run ends at its closing delimiter, which a doubled delimiter escapes.
// Returns the offset just past it.
function closingQuote(sql: string, start: number, closing: string): number {
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] === closing) {
      if (sql[index + 1] !== closing) return index + 1;
      index += 2;
      continue;
    }
    index += 1;
  }
  return sql.length;
}

export function readAppliedVersions(database: DatabaseSync): readonly number[] {
  return query(database, "SELECT version FROM schema_migrations ORDER BY version").map((row) => count(row, "version"));
}

// `schema_migrations` is excluded from the comparisons: the upgraded fixture has
// to create that table itself to reach the migration path, so its declaration is
// the fixture's rather than the product's. Its contents are asserted instead,
// which an older release wrote for a new install without running the migrations.
function readTableNames(database: DatabaseSync): readonly string[] {
  return query(
    database,
    `SELECT name FROM sqlite_master
     WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations'
     ORDER BY name`,
  ).map((row) => text(row, "name"));
}

export function query(database: DatabaseSync, sql: string, ...parameters: SQLInputValue[]): readonly DynamicRecord[] {
  return database
    .prepare(sql)
    .all(...parameters)
    .map((row) => {
      if (!isDynamicRecord(row)) throw new Error(`Unexpected row shape from: ${sql}`);
      return row;
    });
}

export function quote(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function text(row: DynamicRecord, column: string): string {
  const value = row[column];
  if (!isString(value)) throw new Error(`Expected text in column ${column}.`);
  return value;
}

function optionalText(row: DynamicRecord, column: string): string | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  if (isString(value)) return value;
  if (isNumber(value)) return String(value);
  throw new Error(`Expected text or null in column ${column}.`);
}

function count(row: DynamicRecord, column: string): number {
  const value = row[column];
  if (!isNumber(value)) throw new Error(`Expected a number in column ${column}.`);
  return value;
}
