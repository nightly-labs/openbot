import { accessSync, chmodSync, existsSync, constants as fileAccess, statSync } from "node:fs";
import { basename, dirname } from "node:path";
import { createInterface } from "node:readline";
import { constants, DatabaseSync, type StatementSync } from "node:sqlite";
import { Context, Effect, Layer, ManagedRuntime, Result, Schema } from "effect";
import type {
  AgentDatabaseFailure,
  AgentDatabaseHostReady,
  AgentDatabaseLimits,
  AgentDatabaseMode,
  AgentDatabaseParameter,
  AgentDatabaseRequest,
  AgentDatabaseResponse,
  AgentDatabaseRows,
  AgentDatabaseStatement,
  AgentDatabaseValue,
} from "./agent-database-protocol";

const METADATA_TABLE = "openbot_metadata";

const SCHEMA_VERSION = 1;

const MAX_OPEN_DATABASES = 8;

const ALLOWED_VTABLE_MODULES = new Set(["fts5", "fts5vocab", "rtree", "rtreecheck"]);

const MODULE_PRAGMAS = new Set(["data_version", "page_size"]);

const SQLITE_BUSY = 5;
const SQLITE_FULL = 13;
const SQLITE_READONLY_ROLLBACK = 776;
const SQLITE_READONLY = 8;

const DENIED_FUNCTIONS = new Set(["load_extension", "readfile", "writefile", "edit", "fts3_tokenizer"]);

interface OpenDatabase {
  database: DatabaseSync;
  lastUsedAt: number;
}

const open = new Map<string, OpenDatabase>();

let provisioning = false;

let protectedTables = new Set<string>();

function authorize(
  action: number,
  first: string | null,
  second: string | null,
  _database: string | null,
  triggerOrView: string | null,
): number {
  switch (action) {
    case constants.SQLITE_ATTACH:
    case constants.SQLITE_DETACH:
      return constants.SQLITE_DENY;
    case constants.SQLITE_PRAGMA:
      return second === null && first !== null && MODULE_PRAGMAS.has(first.toLowerCase())
        ? constants.SQLITE_OK
        : constants.SQLITE_DENY;
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
      return first === METADATA_TABLE && !(provisioning && triggerOrView === null)
        ? constants.SQLITE_DENY
        : constants.SQLITE_OK;
    case constants.SQLITE_DROP_TABLE:
    case constants.SQLITE_DROP_VTABLE:
      return tableOwnedByAnother(first);
    case constants.SQLITE_ALTER_TABLE:
      return tableOwnedByAnother(second);
    case constants.SQLITE_CREATE_TRIGGER:
    case constants.SQLITE_DROP_TRIGGER:
    case constants.SQLITE_DROP_TEMP_TRIGGER:
      return tableOwnedByAnother(second);
    case constants.SQLITE_CREATE_TEMP_TRIGGER:
      return constants.SQLITE_DENY;
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
    enableDoubleQuotedStringLiterals: false,
    timeout: request.limits.busyTimeoutMs,
  });
  try {
    checkSchemaVersion(database, request.mode);
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

function checkSchemaVersion(database: DatabaseSync, mode: AgentDatabaseMode): void {
  const row = database.prepare("PRAGMA user_version").get();
  const version = row === undefined ? 0 : Number(row.user_version);
  if (version > SCHEMA_VERSION) {
    throw new HostFailure(
      "newer-schema",
      `A newer version of OpenBot made the shared tables file (schema ${version}; this version reads ${SCHEMA_VERSION}). Nothing was read or changed. Install the newer version of OpenBot to use the shared tables.`,
    );
  }
  if (mode === "write" && version < SCHEMA_VERSION) database.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
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
  } catch {}
}

function closePath(databasePath: string): void {
  for (const mode of ["read", "write"] satisfies AgentDatabaseMode[]) closeKey(`${mode}:${databasePath}`);
}

class HostFailure extends Schema.TaggedError<HostFailure>()("AgentDatabaseHostFailure", {
  kind: Schema.Literals(["sqlite", "not-authorized", "size-limit", "busy", "missing", "newer-schema", "internal"]),
  message: Schema.String,
  sqliteCode: Schema.optional(Schema.Number),
}) {
  constructor(kind: AgentDatabaseFailure["kind"], message: string, sqliteCode?: number) {
    super({ kind, message, ...(sqliteCode === undefined ? {} : { sqliteCode }) });
  }

  get failure(): AgentDatabaseFailure {
    return {
      kind: this.kind,
      message: this.message,
      ...(this.sqliteCode === undefined ? {} : { sqliteCode: this.sqliteCode }),
    };
  }
}

function cellValue(value: unknown, maxCellChars: number): AgentDatabaseValue {
  if (value === null || value === undefined) return null;
  if (value instanceof Uint8Array) return { blobBytes: value.byteLength };
  if (typeof value === "bigint") {
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
  for (const raw of statement.iterate(...parameters)) {
    if (rows.length >= limits.maxRows || bytes >= limits.maxResultBytes) {
      truncated = true;
      break;
    }
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

function toFailure(error: unknown, request: AgentDatabaseStatement): AgentDatabaseFailure {
  const { databasePath } = request;
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
  if (request.mode === "write" && code !== undefined && (code & 0xff) === SQLITE_READONLY) {
    return {
      kind: "sqlite",
      message:
        "Nothing was saved, because OpenBot does not have permission to change the shared tables file or its Data folder. The user account that runs OpenBot needs permission to change that folder and the files in it.",
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
        "SQLite refused part of this statement. ATTACH, DETACH, PRAGMA, VACUUM, extensions, and TEMP triggers are not available, and a table another agent created cannot be dropped, altered, or given a trigger.",
      ...(code === undefined ? {} : { sqliteCode: code }),
    };
  }
  return redactFailure({ kind: "sqlite", message, ...(code === undefined ? {} : { sqliteCode: code }) }, databasePath);
}

function redactFailure(failure: AgentDatabaseFailure, databasePath: string): AgentDatabaseFailure {
  return { ...failure, message: failure.message.replaceAll(databasePath, basename(databasePath)) };
}

function checkIntegrity(databasePath: string): Effect.Effect<AgentDatabaseRows, HostFailure> {
  return Effect.try({
    try: () => {
      const database = new DatabaseSync(databasePath, { readOnly: true, timeout: 5_000 });
      try {
        const rows = database
          .prepare("PRAGMA quick_check(20)")
          .all()
          .map((row): AgentDatabaseValue[] => [String(row.quick_check)]);
        return { columns: ["quick_check"], rows, truncated: false, changes: 0, lastInsertRowid: null };
      } finally {
        database.close();
      }
    },
    catch: (error) => {
      const code =
        typeof error === "object" && error !== null && "errcode" in error ? Number(error.errcode) : undefined;
      const failure = redactFailure(
        { kind: "sqlite", message: error instanceof Error ? error.message : String(error) },
        databasePath,
      );
      return new HostFailure(failure.kind, failure.message, code);
    },
  });
}

function databaseCall<A>(request: AgentDatabaseStatement, operation: () => A): Effect.Effect<A, HostFailure> {
  return Effect.try({
    try: operation,
    catch: (error) => {
      const failure = toFailure(error, request);
      return new HostFailure(failure.kind, failure.message, failure.sqliteCode);
    },
  });
}

function rollBackHotJournal(request: AgentDatabaseStatement): Effect.Effect<void, HostFailure> {
  return databaseCall(request, () => {
    openDatabase({ ...request, mode: "write" })
      .prepare("SELECT 1 FROM sqlite_master LIMIT 1")
      .get();
  });
}

function reopenWritable(request: AgentDatabaseStatement): Effect.Effect<void> {
  return Effect.sync(() => {
    closePath(request.databasePath);
    const folder = dirname(request.databasePath);
    for (const [path, ownerBits] of [
      [folder, 0o700],
      [request.databasePath, 0o600],
      [`${request.databasePath}-journal`, 0o600],
      [`${request.databasePath}-wal`, 0o600],
      [`${request.databasePath}-shm`, 0o600],
    ] as const) {
      try {
        accessSync(path, fileAccess.R_OK | fileAccess.W_OK);
      } catch {
        try {
          chmodSync(path, statSync(path).mode | ownerBits);
        } catch {}
      }
    }
  });
}

class AgentDatabaseHost extends Context.Service<
  AgentDatabaseHost,
  { execute(request: AgentDatabaseRequest): Effect.Effect<AgentDatabaseRows, HostFailure> }
>()("openbot/agent-data/AgentDatabaseHost") {
  static readonly layer = Layer.effect(
    AgentDatabaseHost,
    Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.sync(closeEverything));
      const execute = Effect.fn("AgentDatabaseHost.execute")(function* (request: AgentDatabaseRequest) {
        if (request.kind === "close") {
          yield* Effect.sync(() => closePath(request.databasePath));
          return { columns: [], rows: [], truncated: false, changes: 0, lastInsertRowid: null };
        }
        if (request.kind === "integrity-check") return yield* checkIntegrity(request.databasePath);
        return yield* Effect.acquireUseRelease(
          Effect.sync(() => {
            provisioning = request.provision;
            protectedTables = new Set(request.protectedTables.map((table) => table.toLowerCase()));
          }),
          () => {
            const run = Effect.gen(function* () {
              const database = yield* databaseCall(request, () => openDatabase(request));
              const statement = yield* databaseCall(request, () => database.prepare(request.sql));
              return yield* databaseCall(request, () =>
                request.mode === "read"
                  ? readRows(statement, request.parameters, request.limits)
                  : runStatement(statement, request.parameters),
              );
            });
            return run.pipe(
              Effect.catchIf(
                (failure) => request.mode === "read" && failure.sqliteCode === SQLITE_READONLY_ROLLBACK,
                () => rollBackHotJournal(request).pipe(Effect.andThen(run)),
              ),
              Effect.catchIf(
                (failure) =>
                  request.mode === "write" &&
                  failure.sqliteCode !== undefined &&
                  (failure.sqliteCode & 0xff) === SQLITE_READONLY,
                () => reopenWritable(request).pipe(Effect.andThen(run)),
              ),
            );
          },
          () =>
            Effect.sync(() => {
              provisioning = false;
              protectedTables = new Set();
            }),
        );
      });
      return AgentDatabaseHost.of({ execute });
    }),
  );
}

const runtime = ManagedRuntime.make(AgentDatabaseHost.layer);

function handle(request: AgentDatabaseRequest): AgentDatabaseResponse {
  const result = runtime.runSync(Effect.result(AgentDatabaseHost.use((host) => host.execute(request))));
  return Result.isFailure(result)
    ? { id: request.id, ok: false, failure: result.failure.failure }
    : { id: request.id, ok: true, result: result.success };
}

interface ParentPort {
  on(event: "message", listener: (message: { data: unknown }) => void): void;
  postMessage(value: unknown): void;
  start(): void;
}

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

const READY: AgentDatabaseHostReady = { kind: "ready" };

if (parentPort) {
  parentPort.on("message", (message) => accept(message.data, (response) => parentPort.postMessage(response)));
  parentPort.start();
  parentPort.postMessage(READY);
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
    Effect.runSync(runtime.disposeEffect);
    process.exit(0);
  });
  process.stdout.write(`${JSON.stringify(READY)}\n`);
}
