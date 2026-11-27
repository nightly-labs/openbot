import { AsyncLocalStorage } from "node:async_hooks";
import { ACCOUNT_BOOKMARK_HEADER, isAccountBookmark, newerAccountBookmark } from "@openbot/contracts/account-bookmark";

const READ_METHODS = new Set(["GET", "HEAD"]);

type RequestReads = "replica" | "primary";

class D1RequestSession {
  readonly #sessions: D1DatabaseSession[] = [];
  #shared: D1DatabaseSession | null = null;

  constructor(
    readonly source: D1Database,
    readonly reads: RequestReads,
    readonly bookmark: D1SessionBookmark | null,
  ) {}

  target(): D1DatabaseSession {
    if (this.reads === "primary") return this.#track(this.source.withSession("first-primary"));
    this.#shared ??= this.#track(this.source.withSession(this.bookmark ?? "first-primary"));
    return this.#shared;
  }

  replicaTarget(): D1DatabaseSession | null {
    return this.reads === "replica" && this.bookmark !== null ? this.target() : null;
  }

  latestBookmark(): D1SessionBookmark | null {
    return this.#sessions.reduce<D1SessionBookmark | null>(
      (latest, session) => newerAccountBookmark(latest, session.getBookmark()),
      null,
    );
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
  const reads: RequestReads = READ_METHODS.has(request.method) ? "replica" : "primary";
  const session = new D1RequestSession(source, reads, reads === "replica" ? requestBookmark(request) : null);
  const response = await requestSessions.run(session, handle);
  const bookmark = session.latestBookmark();
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
