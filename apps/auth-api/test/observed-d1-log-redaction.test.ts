import { afterEach, describe, expect, it, vi } from "vitest";
import { observedD1 } from "../src/server/observed-d1";

// A D1 message can quote SQL text and a bound value. The log line of a failed call must hold neither.
const SECRET = "person@example.com";
const SQL = `SELECT id FROM users WHERE email = '${SECRET}'`;

class FailingStatement implements D1PreparedStatement {
  calls = 0;
  constructor(readonly message: string) {}
  bind(): D1PreparedStatement {
    return this;
  }
  first(): Promise<never> {
    return this.#fail();
  }
  run(): Promise<never> {
    return this.#fail();
  }
  all(): Promise<never> {
    return this.#fail();
  }
  raw(): Promise<never> {
    return this.#fail();
  }
  #fail(): Promise<never> {
    this.calls += 1;
    return Promise.reject(new Error(this.message));
  }
}

class FailingDatabase implements D1Database {
  readonly statement: FailingStatement;
  constructor(message: string) {
    this.statement = new FailingStatement(message);
  }
  prepare(): D1PreparedStatement {
    return this.statement;
  }
  // Like workerd, `batch` refuses a statement that this database did not make.
  batch(statements: D1PreparedStatement[]): Promise<never> {
    if (statements.some((statement) => statement !== this.statement)) {
      return Promise.reject(new TypeError("Statement is not from this database."));
    }
    return Promise.reject(new Error(this.statement.message));
  }
  exec(): Promise<never> {
    return Promise.reject(new Error(this.statement.message));
  }
  withSession(): D1DatabaseSession {
    throw new Error("Not used.");
  }
  dump(): Promise<never> {
    return Promise.reject(new Error("Not used."));
  }
}

function loggedText(calls: unknown[][]): string {
  return calls.map((call) => call.map(String).join(" ")).join("\n");
}

describe("failed D1 call log", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("logs only the error class of a failed call, never its message, SQL or values", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const database = observedD1(new FailingDatabase(`D1_ERROR: UNIQUE constraint failed: users.email: ${SQL}`));

    await expect(database.prepare(SQL).bind(SECRET).first()).rejects.toThrow();
    await expect(database.batch([database.prepare(SQL).bind(SECRET)])).rejects.toThrow();
    await expect(database.exec(SQL)).rejects.toThrow();

    expect(spy.mock.calls).toEqual([
      ["D1 call failed:", "constraint", "first", "retry=none"],
      ["D1 call failed:", "constraint", "batch", "retry=none"],
      ["D1 call failed:", "constraint", "exec", "retry=none"],
    ]);
    expect(loggedText(spy.mock.calls)).not.toContain(SECRET);
    expect(loggedText(spy.mock.calls)).not.toContain("users");
  });

  it("logs an overloaded read and its one retry without the message", async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const source = new FailingDatabase(`D1_ERROR: D1 DB is overloaded. ${SQL}`);
    const database = observedD1(source);

    const read = database.prepare(SQL).bind(SECRET).all();
    const outcome = expect(read).rejects.toThrow();
    await vi.runAllTimersAsync();
    await outcome;

    expect(source.statement.calls).toBe(2);
    expect(spy.mock.calls).toEqual([["D1 call failed:", "overloaded", "all", "retry=failed"]]);
    expect(loggedText(spy.mock.calls)).not.toContain(SECRET);
  });
});
