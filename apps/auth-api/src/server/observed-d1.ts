type D1FailureClass = "overloaded" | "constraint" | "network" | "other";

type D1RetryOutcome = "none" | "succeeded" | "failed";

type D1Operation = "first" | "all" | "raw" | "run" | "batch" | "exec";

const OVERLOADED_RETRY_MIN_DELAY_MS = 500;
const OVERLOADED_RETRY_DELAY_SPREAD_MS = 1_000;
const UNRECOVERED_OVERLOAD_WINDOW_MS = 10_000;
const READ_ONLY_SQL = /^\s*(SELECT|WITH)\b/i;
const WRITE_KEYWORD = /\b(INSERT|UPDATE|DELETE|REPLACE|UPSERT)\b/i;

const observedDatabases = new WeakMap<D1Database, D1Database>();
const replicaDatabases = new WeakMap<D1Database, D1Database>();

let unrecoveredOverloadAt = Number.NEGATIVE_INFINITY;

export function d1OverloadedRecently(now: number): boolean {
  return now - unrecoveredOverloadAt < UNRECOVERED_OVERLOAD_WINDOW_MS;
}

function rememberUnrecovered(failure: D1FailureClass): void {
  if (failure === "overloaded") unrecoveredOverloadAt = Date.now();
}

function d1FailureClass(error: unknown): D1FailureClass {
  const message = error instanceof Error ? error.message : String(error);
  if (/overloaded/i.test(message)) return "overloaded";
  if (/constraint failed/i.test(message)) return "constraint";
  if (/network connection lost|connection reset|internal error|timed? ?out/i.test(message)) return "network";
  return "other";
}

function logD1Failure(operation: D1Operation, failure: D1FailureClass, retry: D1RetryOutcome): void {
  console.error("D1 call failed:", failure, operation, `retry=${retry}`);
}

function isReadOnly(sql: string): boolean {
  return READ_ONLY_SQL.test(sql) && !WRITE_KEYWORD.test(sql);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function observedCall<T>(operation: D1Operation, readOnly: boolean, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    const failure = d1FailureClass(error);
    if (failure !== "overloaded" || !readOnly) {
      logD1Failure(operation, failure, "none");
      rememberUnrecovered(failure);
      throw error;
    }
    await wait(OVERLOADED_RETRY_MIN_DELAY_MS + Math.random() * OVERLOADED_RETRY_DELAY_SPREAD_MS);
    try {
      const result = await call();
      logD1Failure(operation, failure, "succeeded");
      return result;
    } catch (retryError) {
      const retryFailure = d1FailureClass(retryError);
      logD1Failure(operation, retryFailure, "failed");
      rememberUnrecovered(retryFailure);
      throw retryError;
    }
  }
}

class ObservedStatement implements D1PreparedStatement {
  readonly #readOnly: boolean;

  constructor(
    readonly source: D1PreparedStatement,
    readonly sql: string,
  ) {
    this.#readOnly = isReadOnly(sql);
  }

  bind(...values: unknown[]): D1PreparedStatement {
    return new ObservedStatement(this.source.bind(...values), this.sql);
  }

  first<T>(column?: string): Promise<T | null> {
    return observedCall("first", this.#readOnly, () =>
      column === undefined ? this.source.first<T>() : this.source.first<T>(column),
    );
  }

  run<T>(): Promise<D1Result<T>> {
    return observedCall("run", this.#readOnly, () => this.source.run<T>());
  }

  all<T>(): Promise<D1Result<T>> {
    return observedCall("all", this.#readOnly, () => this.source.all<T>());
  }

  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<[string[], ...T[]] | T[]> {
    if (options?.columnNames) {
      return observedCall("raw", this.#readOnly, () => this.source.raw<T>({ columnNames: true }));
    }
    return observedCall("raw", this.#readOnly, () => this.source.raw<T>());
  }
}

class ObservedDatabase implements D1Database {
  constructor(
    readonly source: D1Database,
    readonly replicaReads: boolean,
  ) {}

  #target(): D1Database | D1DatabaseSession {
    return this.replicaReads ? this.source.withSession("first-unconstrained") : this.source;
  }

  prepare(query: string): D1PreparedStatement {
    return new ObservedStatement(this.#target().prepare(query), query);
  }

  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const sources = statements.map((statement) =>
      statement instanceof ObservedStatement ? statement.source : statement,
    );
    const target = this.#target();
    return observedCall("batch", false, () => target.batch<T>(sources));
  }

  exec(query: string): Promise<D1ExecResult> {
    return observedCall("exec", false, () => this.source.exec(query));
  }

  withSession(constraintOrBookmark?: D1SessionBookmark | D1SessionConstraint): D1DatabaseSession {
    return this.source.withSession(constraintOrBookmark);
  }

  dump(): Promise<ArrayBuffer> {
    return this.source.dump();
  }
}

export function observedD1(database: D1Database): D1Database {
  if (database instanceof ObservedDatabase) return database;
  const known = observedDatabases.get(database);
  if (known) return known;
  const observed = new ObservedDatabase(database, false);
  observedDatabases.set(database, observed);
  return observed;
}

export function replicaD1(database: D1Database): D1Database {
  const source = database instanceof ObservedDatabase ? database.source : database;
  const known = replicaDatabases.get(source);
  if (known) return known;
  const replica = new ObservedDatabase(source, true);
  replicaDatabases.set(source, replica);
  return replica;
}
