// The child process that is the only thing in OpenBot allowed to open the shared agent database.
//
// It is separate from the main process for one measured reason: a runaway statement cannot be
// interrupted. `sqlite3_step` never returns to JavaScript, so V8 never reaches an interrupt point,
// so `worker.terminate()` never resolves and `DatabaseSync` offers no `interrupt`. A process can be
// sent SIGKILL. That is the whole argument for this file existing.
//
// RULE: every runtime import here is `node:*`. Repo shapes come in through `import type`, which both
// Rollup and Node's type stripping erase. That keeps the built chunk standalone, lets the tests
// spawn this source directly and drive the real host, and makes it impossible for Electron or the
// `openbot.db` facade to be dragged in behind it.

import { existsSync } from "node:fs";
import { basename } from "node:path";
import { createInterface } from "node:readline";
import { constants, DatabaseSync, type StatementSync } from "node:sqlite";
import type {
  AgentDatabaseFailure,
  AgentDatabaseLimits,
  AgentDatabaseMode,
  AgentDatabaseParameter,
  AgentDatabaseRequest,
  AgentDatabaseResponse,
  AgentDatabaseRows,
  AgentDatabaseStatement,
  AgentDatabaseValue,
} from "./agent-database-protocol";

/** Mirrors `AGENT_DATABASE_METADATA_TABLE`; inlined because the protocol module must stay type-only here. */
const METADATA_TABLE = "openbot_metadata";

const MAX_OPEN_DATABASES = 8;

/** Virtual table modules an agent may build on. Everything else reaches a file or the engine's internals. */
const ALLOWED_VTABLE_MODULES = new Set(["fts5", "fts5vocab", "rtree", "rtreecheck"]);

/**
 * Result codes `node:sqlite` reports on `error.errcode` but does not export as constants, unlike the
 * authorizer action codes.
 */
const SQLITE_BUSY = 5;
const SQLITE_FULL = 13;

/** Functions SQLite can compile in that read, write, or load code from the filesystem. */
const DENIED_FUNCTIONS = new Set(["load_extension", "readfile", "writefile", "edit", "fts3_tokenizer"]);

interface OpenDatabase {
  database: DatabaseSync;
  lastUsedAt: number;
}

const open = new Map<string, OpenDatabase>();

/** True only while the current statement is one `AgentTables` wrote to set up the file itself. */
let provisioning = false;

/**
 * Tables the agent behind the current statement did not create. Set per request rather than per
 * connection, because one cached connection serves every agent.
 */
let protectedTables = new Set<string>();

/**
 * The containment boundary. Read-only handles and the statement scanner both sit in front of this,
 * but this is the one that SQLite itself enforces, on the compiled statement rather than on its
 * text. Denying `SQLITE_ATTACH` alone closes both `ATTACH DATABASE` and `VACUUM INTO '<path>'` --
 * the only two ways statement text can name a file.
 */
function authorize(action: number, first: string | null, second: string | null): number {
  switch (action) {
    case constants.SQLITE_ATTACH:
    case constants.SQLITE_DETACH:
    case constants.SQLITE_PRAGMA:
    case constants.SQLITE_DROP_VTABLE:
      return constants.SQLITE_DENY;
    case constants.SQLITE_CREATE_VTABLE:
      return second !== null && ALLOWED_VTABLE_MODULES.has(second.toLowerCase())
        ? constants.SQLITE_OK
        : constants.SQLITE_DENY;
    case constants.SQLITE_FUNCTION:
      return second !== null && DENIED_FUNCTIONS.has(second.toLowerCase())
        ? constants.SQLITE_DENY
        : constants.SQLITE_OK;
    case constants.SQLITE_INSERT:
    case constants.SQLITE_UPDATE:
    case constants.SQLITE_DELETE:
      // The owner record. An agent may read it -- that is how `list_tables` reports the owner
      // without a PRAGMA -- but nothing an agent writes may reassign or erase it. `provisioning` is
      // set only while `AgentTables` writes the record itself, from SQL no agent supplied.
      return first === METADATA_TABLE && !provisioning ? constants.SQLITE_DENY : constants.SQLITE_OK;
    // Every agent may change the rows in every table, but only the agent that made a table may
    // remove or reshape it. SQLite reports the target table itself, so the rule is decided on the
    // compiled statement rather than on a guess about what the SQL text means. The two actions name
    // it in different arguments: `DROP TABLE` in the first, `ALTER TABLE` in the second, after the
    // database name.
    case constants.SQLITE_DROP_TABLE:
      return tableOwnedByAnother(first);
    case constants.SQLITE_ALTER_TABLE:
      return tableOwnedByAnother(second);
    default:
      return constants.SQLITE_OK;
  }
}

function tableOwnedByAnother(table: string | null): number {
  if (provisioning) return constants.SQLITE_OK;
  if (table === null) return constants.SQLITE_OK;
  const name = table.toLowerCase();
  return name === METADATA_TABLE || protectedTables.has(name) ? constants.SQLITE_DENY : constants.SQLITE_OK;
}

function openDatabase(request: AgentDatabaseStatement): DatabaseSync {
  const key = `${request.mode}:${request.databasePath}`;
  const cached = open.get(key);
  if (cached) {
    cached.lastUsedAt = Date.now();
    return cached.database;
  }
  if (!request.provision && !existsSync(request.databasePath)) {
    throw new HostFailure(
      "missing",
      `${basename(request.databasePath)} does not exist yet. Write something to it first.`,
    );
  }

  const database = new DatabaseSync(request.databasePath, {
    readOnly: request.mode === "read",
    allowExtension: false,
    enableForeignKeyConstraints: true,
    // Off, so `WHERE name = "alice"` stays a visible "no such column" rather than a comparison that
    // is silently always false. It is the most common mistake in model-written SQL.
    enableDoubleQuotedStringLiterals: false,
    timeout: request.limits.busyTimeoutMs,
  });
  try {
    // Before the authorizer, which denies SQLITE_PRAGMA outright.
    database.exec("PRAGMA trusted_schema = OFF");
    database.exec(`PRAGMA max_page_count = ${request.limits.maxPageCount}`);
    if (typeof database.setAuthorizer !== "function") {
      throw new HostFailure("internal", "Shared data is unavailable in this build.");
    }
    database.setAuthorizer(authorize);
  } catch (error) {
    database.close();
    throw error;
  }

  evictOldest();
  open.set(key, { database, lastUsedAt: Date.now() });
  return database;
}

function evictOldest(): void {
  while (open.size >= MAX_OPEN_DATABASES) {
    let oldestKey: string | null = null;
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [key, entry] of open) {
      if (entry.lastUsedAt < oldestAt) {
        oldestAt = entry.lastUsedAt;
        oldestKey = key;
      }
    }
    if (oldestKey === null) return;
    closeKey(oldestKey);
  }
}

function closeKey(key: string): void {
  const entry = open.get(key);
  if (!entry) return;
  open.delete(key);
  try {
    entry.database.close();
  } catch {
    // A handle that will not close is already unusable, and the process is disposable.
  }
}

function closePath(databasePath: string): void {
  for (const mode of ["read", "write"] satisfies AgentDatabaseMode[]) closeKey(`${mode}:${databasePath}`);
}

/** A failure that already carries the sentence a model should read. */
class HostFailure extends Error {
  readonly failure: AgentDatabaseFailure;

  constructor(kind: AgentDatabaseFailure["kind"], message: string, sqliteCode?: number) {
    super(message);
    this.failure = sqliteCode === undefined ? { kind, message } : { kind, message, sqliteCode };
  }
}

function cellValue(value: unknown, maxCellChars: number): AgentDatabaseValue {
  if (value === null || value === undefined) return null;
  if (value instanceof Uint8Array) return { blobBytes: value.byteLength };
  if (typeof value === "bigint") {
    // Outside the safe range a number would silently change; the text keeps every digit.
    return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
  }
  if (typeof value === "number") return value;
  const text = String(value);
  return text.length > maxCellChars ? `${text.slice(0, maxCellChars)}…` : text;
}

function readRows(
  statement: StatementSync,
  parameters: readonly AgentDatabaseParameter[],
  limits: AgentDatabaseLimits,
): AgentDatabaseRows {
  const columns = statement.columns().map((column, index) => column.name ?? column.column ?? `column${index + 1}`);
  statement.setReturnArrays(true);
  const rows: AgentDatabaseValue[][] = [];
  let bytes = 0;
  let truncated = false;
  // `iterate` rather than `all`, so a statement that would return a million rows stops costing
  // memory at the cap instead of after it.
  for (const raw of statement.iterate(...parameters)) {
    if (rows.length >= limits.maxRows || bytes >= limits.maxResultBytes) {
      truncated = true;
      break;
    }
    // `setReturnArrays(true)` makes every row an array at run time; the declared type still says
    // record, so read it as one rather than asserting over the declaration.
    const cells: unknown[] = Array.isArray(raw) ? raw : Object.values(raw);
    const row = cells.map((value) => cellValue(value, limits.maxCellChars));
    bytes += JSON.stringify(row).length;
    rows.push(row);
  }
  return { columns, rows, truncated, changes: 0, lastInsertRowid: null };
}

function runStatement(statement: StatementSync, parameters: readonly AgentDatabaseParameter[]): AgentDatabaseRows {
  const result = statement.run(...parameters);
  const rowid = result.lastInsertRowid;
  return {
    columns: [],
    rows: [],
    truncated: false,
    changes: Number(result.changes),
    lastInsertRowid: typeof rowid === "bigint" ? (Number.isSafeInteger(Number(rowid)) ? Number(rowid) : null) : rowid,
  };
}

/**
 * SQLite's own sentence is usually the best one a model can get -- "no such table: users" and
 * "UNIQUE constraint failed: users.email" are exactly what it needs to fix its next call. Only the
 * three that would mislead are rewritten, and the absolute path is removed from every one of them
 * because these sentences are logged and shown.
 */
function toFailure(error: unknown, databasePath: string): AgentDatabaseFailure {
  if (error instanceof HostFailure) return redactFailure(error.failure, databasePath);
  const code = typeof error === "object" && error !== null && "errcode" in error ? Number(error.errcode) : undefined;
  const message = error instanceof Error ? error.message : String(error);

  if (code === SQLITE_FULL) {
    return {
      kind: "size-limit",
      message: "The shared database reached its 256 MB limit. Delete rows or tables that are no longer needed.",
      sqliteCode: code,
    };
  }
  if (code === SQLITE_BUSY) {
    return {
      kind: "busy",
      message: "The shared database was busy with another statement. Try the call again.",
      sqliteCode: code,
    };
  }
  if (/not authorized/i.test(message)) {
    return {
      kind: "not-authorized",
      message:
        "SQLite refused part of this statement. ATTACH, DETACH, PRAGMA, VACUUM, and extensions are not available, and a table another agent created cannot be dropped or altered.",
      sqliteCode: code,
    };
  }
  return redactFailure({ kind: "sqlite", message, ...(code === undefined ? {} : { sqliteCode: code }) }, databasePath);
}

function redactFailure(failure: AgentDatabaseFailure, databasePath: string): AgentDatabaseFailure {
  return { ...failure, message: failure.message.replaceAll(databasePath, basename(databasePath)) };
}

function handle(request: AgentDatabaseRequest): AgentDatabaseResponse {
  if (request.kind === "close") {
    closePath(request.databasePath);
    return {
      id: request.id,
      ok: true,
      result: { columns: [], rows: [], truncated: false, changes: 0, lastInsertRowid: null },
    };
  }
  provisioning = request.provision;
  protectedTables = new Set(request.protectedTables.map((table) => table.toLowerCase()));
  try {
    const database = openDatabase(request);
    const statement = database.prepare(request.sql);
    const result =
      request.mode === "read"
        ? readRows(statement, request.parameters, request.limits)
        : runStatement(statement, request.parameters);
    return { id: request.id, ok: true, result };
  } catch (error) {
    return { id: request.id, ok: false, failure: toFailure(error, request.databasePath) };
  } finally {
    provisioning = false;
    protectedTables = new Set();
  }
}

/**
 * The two ways this file is started, and the only place either one is named.
 *
 * In the packaged app it is an Electron `utilityProcess`, which has no stdin -- the app ships the
 * `runAsNode: false` fuse, so `process.execPath` cannot be run as Node and a plain child process is
 * not available. A `utilityProcess` is talked to through `process.parentPort`, which Electron adds
 * and `@types/node` does not describe; the narrow shape below is what this file uses of it, declared
 * rather than asserted so no type is widened to reach it.
 *
 * Under a real `node` -- which is how the tests drive this file, straight from its TypeScript source
 * -- there is no parent port and the transport is newline-delimited JSON over stdio.
 */
interface ParentPort {
  on(event: "message", listener: (message: { data: unknown }) => void): void;
  postMessage(value: unknown): void;
  start(): void;
}

/**
 * `process.parentPort` exists only when Electron forked this file as a `utilityProcess`. It is read
 * through a guard rather than Electron's own type, because this file must not import Electron.
 */
function isParentPort(value: unknown): value is ParentPort {
  return typeof value === "object" && value !== null && "postMessage" in value && "start" in value;
}

const parentPort: ParentPort | undefined = isParentPort(process.parentPort) ? process.parentPort : undefined;

function accept(value: unknown, respond: (response: AgentDatabaseResponse) => void): void {
  if (!isRequest(value)) return;
  respond(handle(value));
}

function isRequest(value: unknown): value is AgentDatabaseRequest {
  return typeof value === "object" && value !== null && "kind" in value && "id" in value;
}

function closeEverything(): void {
  for (const key of [...open.keys()]) closeKey(key);
}

if (parentPort) {
  parentPort.on("message", (message) => accept(message.data, (response) => parentPort.postMessage(response)));
  parentPort.start();
} else {
  const lines = createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    if (line.trim().length === 0) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    accept(parsed, (response) => process.stdout.write(`${JSON.stringify(response)}\n`));
  });
  lines.on("close", () => {
    closeEverything();
    process.exit(0);
  });
}
