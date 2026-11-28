import { AsyncLocalStorage } from "node:async_hooks";
import { ACCOUNT_BOOKMARK_HEADER, isAccountBookmark, newerAccountBookmark } from "@openbot/contracts/account-bookmark";

const READ_METHODS = new Set(["GET", "HEAD"]);
const REFUSALS_TO_RECHECK = new Set([403, 404]);

type RequestReads = "replica" | "primary" | "recheck";

function emptyResult(result: unknown): boolean {
  if (result === null) return true;
  if (Array.isArray(result)) return result.length === 0;
  if (typeof result === "object" && "results" in result && Array.isArray(result.results))
    return result.results.length === 0;
  return false;
}

class MissRecordingStatement implements D1PreparedStatement {
  constructor(
    readonly source: D1PreparedStatement,
    readonly recordMiss: () => void,
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new MissRecordingStatement(this.source.bind(...values), this.recordMiss);
  }

  first<T>(column?: string): Promise<T | null> {
    return this.#recorded(column === undefined ? this.source.first<T>() : this.source.first<T>(column));
  }

  run<T>(): Promise<D1Result<T>> {
    return this.source.run<T>();
  }

  all<T>(): Promise<D1Result<T>> {
    return this.#recorded(this.source.all<T>());
  }

  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<[string[], ...T[]] | T[]> {
    if (options?.columnNames)
      return this.source.raw<T>({ columnNames: true }).then((rows) => {
        if (rows.length <= 1) this.recordMiss();
        return rows;
      });
    return this.#recorded(this.source.raw<T>());
  }

  async #recorded<T>(result: Promise<T>): Promise<T> {
    const value = await result;
    if (emptyResult(value)) this.recordMiss();
    return value;
  }
}

class MissRecordingSession implements D1DatabaseSession {
  constructor(
    readonly source: D1DatabaseSession,
    readonly recordMiss: () => void,
  ) {}

  prepare(query: string): D1PreparedStatement {
    return new MissRecordingStatement(this.source.prepare(query), this.recordMiss);
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const results = await this.source.batch<T>(
      statements.map((statement) => (statement instanceof MissRecordingStatement ? statement.source : statement)),
    );
    if (results.some(emptyResult)) this.recordMiss();
    return results;
  }

  getBookmark(): D1SessionBookmark | null {
    return this.source.getBookmark();
  }
}

class D1RequestSession {
  readonly #sessions: D1DatabaseSession[] = [];
  #shared: D1DatabaseSession | null = null;
  #replicaMissedRow = false;

  constructor(
    readonly source: D1Database,
    readonly reads: RequestReads,
    readonly bookmark: D1SessionBookmark | null,
  ) {}

  get replicaMissedRow(): boolean {
    return this.#replicaMissedRow;
  }

  target(): D1DatabaseSession {
    if (this.reads === "primary") return this.#track(this.source.withSession("first-primary"));
    this.#shared ??= this.#sharedSession();
    return this.#shared;
  }

  replicaTarget(): D1DatabaseSession | null {
    return this.reads === "primary" ? null : this.target();
  }

  latestBookmark(): D1SessionBookmark | null {
    return this.#sessions.reduce<D1SessionBookmark | null>(
      (latest, session) => newerAccountBookmark(latest, session.getBookmark()),
      null,
    );
  }

  #sharedSession(): D1DatabaseSession {
    const session = this.#track(this.source.withSession(this.#sharedStart()));
    if (this.reads !== "replica") return session;
    return new MissRecordingSession(session, () => {
      this.#replicaMissedRow = true;
    });
  }

  #sharedStart(): D1SessionConstraint | D1SessionBookmark {
    if (this.reads === "recheck") return "first-primary";
    return this.bookmark ?? "first-unconstrained";
  }

  #track(session: D1DatabaseSession): D1DatabaseSession {
    this.#sessions.push(session);
    return session;
  }
}

const requestSessions = new AsyncLocalStorage<D1RequestSession>();

function requestBookmark(request: Request): D1SessionBookmark | null {
  const value = request.headers.get(ACCOUNT_BOOKMARK_HEADER);
  return isAccountBookmark(value) ? value : null;
}

export function d1RequestTarget(source: D1Database): D1DatabaseSession | null {
  const session = requestSessions.getStore();
  return session?.source === source ? session.target() : null;
}

export function d1RequestReplicaTarget(source: D1Database): D1DatabaseSession | null {
  const session = requestSessions.getStore();
  return session?.source === source ? session.replicaTarget() : null;
}

export async function withD1RequestSession(
  request: Request,
  source: D1Database | undefined,
  handle: () => Promise<Response>,
): Promise<Response> {
  if (!source) return handle();
  if (!READ_METHODS.has(request.method)) {
    const session = new D1RequestSession(source, "primary", null);
    return withBookmark(request, await requestSessions.run(session, handle), session.latestBookmark());
  }
  const replica = new D1RequestSession(source, "replica", requestBookmark(request));
  const response = await requestSessions.run(replica, handle);
  if (!replica.replicaMissedRow || !REFUSALS_TO_RECHECK.has(response.status))
    return withBookmark(request, response, replica.latestBookmark());
  await response.body?.cancel();
  const recheck = new D1RequestSession(source, "recheck", null);
  const confirmed = await requestSessions.run(recheck, handle);
  return withBookmark(request, confirmed, newerAccountBookmark(replica.latestBookmark(), recheck.latestBookmark()));
}

function withBookmark(request: Request, response: Response, bookmark: D1SessionBookmark | null): Response {
  if (bookmark === null || response.status < 200 || !sentByAccountClient(request)) return response;
  const marked = new Response(response.body, response);
  marked.headers.set(ACCOUNT_BOOKMARK_HEADER, bookmark);
  return marked;
}

function sentByAccountClient(request: Request): boolean {
  return (
    request.headers.has("Authorization") ||
    request.headers.has("X-OpenBot-Browser") ||
    request.headers.has(ACCOUNT_BOOKMARK_HEADER)
  );
}
