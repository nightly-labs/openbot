/**
 * The D1 binding of the Worker, with two additions at the I/O boundary:
 *
 * - Each failed D1 call writes one log line with a fixed error class. The services map a D1 failure
 *   to their own error and keep the cause private, so without this line a 500 does not show why D1
 *   failed. The line never holds the error message: a D1 message can quote SQL text or a value.
 * - A read that fails because D1 is overloaded runs one more time after a short wait. D1 refuses
 *   calls for about a minute at a time when its queue is full (2026-11-04: "D1 DB is overloaded.
 *   Requests queued for too long."), and most calls in that minute still pass. Writes do not run
 *   again: D1 can apply a write and still report a failure.
 */

/** The only values a failed D1 call writes to the log. */
type D1FailureClass = "overloaded" | "constraint" | "network" | "other";

/** What the one retry of an overloaded read did. `none`: the call did not run again. */
type D1RetryOutcome = "none" | "succeeded" | "failed";

type D1Operation = "first" | "all" | "raw" | "run" | "batch" | "exec";

const OVERLOADED_RETRY_DELAY_MS = 1_000;
const READ_ONLY_SQL = /^\s*(SELECT|WITH)\b/i;
const WRITE_KEYWORD = /\b(INSERT|UPDATE|DELETE|REPLACE|UPSERT)\b/i;

const observedDatabases = new WeakMap<D1Database, D1Database>();

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
      throw error;
    }
    await wait(OVERLOADED_RETRY_DELAY_MS);
    try {
      const result = await call();
      logD1Failure(operation, failure, "succeeded");
      return result;
    } catch (retryError) {
      logD1Failure(operation, d1FailureClass(retryError), "failed");
      throw retryError;
    }
  }
}

class ObservedStatement implements D1PreparedStatement {
  readonly #readOnly: boolean;

  /** The statement that D1 made. `batch` takes only D1's own statements. */
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
  constructor(readonly source: D1Database) {}

  prepare(query: string): D1PreparedStatement {
    return new ObservedStatement(this.source.prepare(query), query);
  }

  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const sources = statements.map((statement) =>
      statement instanceof ObservedStatement ? statement.source : statement,
    );
    return observedCall("batch", false, () => this.source.batch<T>(sources));
  }

  exec(query: string): Promise<D1ExecResult> {
    return observedCall("exec", false, () => this.source.exec(query));
  }

  /** Not observed. The Worker does not use sessions. */
  withSession(constraintOrBookmark?: D1SessionBookmark | D1SessionConstraint): D1DatabaseSession {
    return this.source.withSession(constraintOrBookmark);
  }

  dump(): Promise<ArrayBuffer> {
    return this.source.dump();
  }
}

/** The same database, with a log line for each failed call and one retry of an overloaded read. */
export function observedD1(database: D1Database): D1Database {
  if (database instanceof ObservedDatabase) return database;
  const known = observedDatabases.get(database);
  if (known) return known;
  const observed = new ObservedDatabase(database);
  observedDatabases.set(database, observed);
  return observed;
}
