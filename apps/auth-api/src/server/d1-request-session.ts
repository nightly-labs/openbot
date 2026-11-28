import { AsyncLocalStorage } from "node:async_hooks";
import { ACCOUNT_BOOKMARK_HEADER, isAccountBookmark, newerAccountBookmark } from "@openbot/contracts/account-bookmark";

const READ_METHODS = new Set(["GET", "HEAD"]);
const REFUSALS_TO_RECHECK = new Set([403, 404]);

type RequestReads = "replica" | "primary" | "recheck";

class D1RequestSession {
  readonly #sessions: D1DatabaseSession[] = [];
  #shared: D1DatabaseSession | null = null;

  constructor(
    readonly source: D1Database,
    readonly reads: RequestReads,
    readonly bookmark: D1SessionBookmark | null,
  ) {}

  get readShared(): boolean {
    return this.#shared !== null;
  }

  target(): D1DatabaseSession {
    if (this.reads === "primary") return this.#track(this.source.withSession("first-primary"));
    this.#shared ??= this.#track(this.source.withSession(this.#sharedStart()));
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
  if (!replica.readShared || !REFUSALS_TO_RECHECK.has(response.status))
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
