import { Effect } from "effect";
import { decodeJwt } from "jose";
import { type HostStateStore, hostStateStore } from "../src/server/host-state";
import { HostState, type HostStateSnapshot } from "../src/server/host-state-object";
import {
  deliverPendingRemoteAuthEvents,
  RemoteControlPlane,
  type RemoteResumeClaims,
  retryPendingHostStateInvalidations,
} from "../src/server/remote-control-plane";
import type { AuthUser } from "../src/server/types";

export { HostState };

export class BrokenHostState extends HostState {
  override read(): HostStateSnapshot {
    throw new Error("host state unavailable");
  }

  override fill(): boolean {
    throw new Error("host state unavailable");
  }

  override invalidate(): number {
    throw new Error("host state unavailable");
  }
}

interface ProbeEnv {
  DB: D1Database;
  HOST_STATE?: DurableObjectNamespace<HostState>;
  BROKEN_HOST_STATE?: DurableObjectNamespace<BrokenHostState>;
  REMOTE_TICKET_PRIVATE_JWK: string;
  REMOTE_TICKET_PUBLIC_JWKS: string;
  REMOTE_TICKET_KEY_ID: string;
}

interface D1Call {
  session: string;
  sql: string;
}

interface D1Count {
  rowsRead: number;
}

export type ProbeRequest =
  | { op: "ticket"; hostId: string; token: string }
  | { op: "homes"; hostId: string; token: string }
  | { op: "rotate"; hostId: string; token: string; user: AuthUser; ownerMembershipId: string }
  | { op: "revoke-member"; hostId: string; actorUserId: string; membershipId: string }
  | { op: "revoke-host"; hostId: string; token: string; user: AuthUser }
  | { op: "state"; hostId: string }
  | { op: "host-state-retry" }
  | { op: "minute-cron" }
  | { op: "session-start"; userId: string; hostId: string; authSessionHash: string }
  | { op: "session-ticket"; userId: string; sessionId: string; signedInTokenHash: string }
  | { op: "end-session"; userId: string; sessionId: string }
  | { op: "revoke-sign-in"; tokenHash: string; at: number }
  | { op: "validate-batch"; claims: RemoteResumeClaims[] }
  | { op: "session-open"; hostId: string; sessionId: string }
  | { op: "list-hosts"; userId: string }
  | { op: "license-changed"; ownerUserId: string; users: number };

interface ProbeOptions {
  mode: string;
  broken: boolean;
  clock: number;
  failInvalidate?: boolean;
}

const HOST_STATE_RETRY_TARGETS = JSON.stringify(["host-state:"]);

function compactSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

class CountedStatement implements D1PreparedStatement {
  constructor(
    readonly statement: D1PreparedStatement,
    readonly count: D1Count,
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new CountedStatement(this.statement.bind(...values), this.count);
  }

  first<T = unknown>(colName: string): Promise<T | null>;
  first<T>(): Promise<T | null>;
  async first<T>(colName?: string): Promise<T | null> {
    if (colName !== undefined) return this.statement.first<T>(colName);
    const result = await this.all<T>();
    return result.results[0] ?? null;
  }

  async run<T>(): Promise<D1Result<T>> {
    return this.counted(await this.statement.run<T>());
  }

  async all<T>(): Promise<D1Result<T>> {
    return this.counted(await this.statement.all<T>());
  }

  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<[string[], ...T[]] | T[]> {
    return options?.columnNames
      ? this.statement.raw<T>({ columnNames: true })
      : this.statement.raw<T>({ columnNames: false });
  }

  counted<T>(result: D1Result<T>): D1Result<T> {
    this.count.rowsRead += result.meta.rows_read ?? 0;
    return result;
  }
}

function countedBatch(source: D1Database | D1DatabaseSession, count: D1Count) {
  return async <T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> => {
    const results = await source.batch<T>(
      statements.map((statement) => (statement instanceof CountedStatement ? statement.statement : statement)),
    );
    for (const result of results) count.rowsRead += result.meta.rows_read ?? 0;
    return results;
  };
}

function countedStatements(source: D1Database | D1DatabaseSession, session: string, calls: D1Call[], count: D1Count) {
  return (sql: string) => {
    calls.push({ session, sql: compactSql(sql) });
    return new CountedStatement(source.prepare(sql), count);
  };
}

function countedDatabase(database: D1Database, calls: D1Call[], count: D1Count): D1Database {
  return {
    prepare: countedStatements(database, "primary", calls, count),
    batch: countedBatch(database, count),
    exec: (query) => {
      calls.push({ session: "primary", sql: compactSql(query) });
      return database.exec(query);
    },
    withSession: (constraint) => {
      const session = database.withSession(constraint);
      const label = typeof constraint === "string" ? constraint : "unconstrained";
      return {
        prepare: countedStatements(session, label, calls, count),
        batch: countedBatch(session, count),
        getBookmark: () => session.getBookmark(),
      };
    },
    dump: () => database.dump(),
  };
}

function hostStateBinding(env: ProbeEnv, options: ProbeOptions) {
  if (options.broken) return env.BROKEN_HOST_STATE;
  return env.HOST_STATE;
}

function probeHostState(env: ProbeEnv, options: ProbeOptions): HostStateStore | null {
  const store = hostStateStore(hostStateBinding(env, options), options.mode);
  if (!store || !options.failInvalidate) return store;
  return { ...store, invalidate: () => Effect.succeed(false) };
}

async function pendingRetries(env: ProbeEnv, hostId?: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS pending FROM remote_auth_events WHERE pending_targets = ? AND (? IS NULL OR json_extract(payload, '$.hostId') = ?)",
  )
    .bind(HOST_STATE_RETRY_TARGETS, hostId ?? null, hostId ?? null)
    .first<{ pending: number }>();
  return row?.pending ?? 0;
}

async function outcome<A>(operation: Effect.Effect<A, object>) {
  const result = await Effect.runPromise(Effect.result(operation));
  if (result._tag === "Success") return { ok: true as const, value: result.success };
  const failure = result.failure;
  return {
    ok: false as const,
    code: "code" in failure ? String(failure.code) : failure.constructor.name,
    status: "status" in failure ? Number(failure.status) : null,
  };
}

function ticketEpoch(ticket: string): number | null {
  const epoch = decodeJwt(ticket).authEpoch;
  return typeof epoch === "number" ? epoch : null;
}

async function run(
  plane: RemoteControlPlane,
  request: ProbeRequest,
  env: ProbeEnv,
  options: ProbeOptions,
  database: D1Database,
) {
  switch (request.op) {
    case "ticket": {
      const result = await outcome(
        plane.issueHostTicket(request.hostId, request.token, { signalHome: false, failedSignalUrl: null }),
      );
      return result.ok ? { ok: true, authEpoch: ticketEpoch(result.value.ticket) } : result;
    }
    case "homes": {
      const result = await outcome(plane.listSignalHomes(request.hostId, request.token));
      return result.ok ? { ok: true } : result;
    }
    case "rotate": {
      const result = await outcome(
        plane.registerHost(request.user, {
          hostId: request.hostId,
          name: "Probe host",
          ownerMembershipId: request.ownerMembershipId,
          rotateCredential: true,
          machineToken: request.token,
        }),
      );
      return result.ok
        ? { ok: true, machineToken: result.value.machineToken, authEpoch: result.value.authEpoch }
        : result;
    }
    case "revoke-member": {
      const result = await outcome(
        plane.changeMembership(request.actorUserId, {
          hostId: request.hostId,
          membershipId: request.membershipId,
          revoke: true,
        }),
      );
      return result.ok ? { ok: true } : result;
    }
    case "revoke-host": {
      const result = await outcome(
        plane.revokeHostCredential(request.user, { hostId: request.hostId, machineToken: request.token }),
      );
      return result.ok ? { ok: true } : result;
    }
    case "state": {
      if (!env.HOST_STATE) return { ok: false, code: "no_binding" };
      const snapshot = await env.HOST_STATE.get(env.HOST_STATE.idFromName(request.hostId)).read({ credential: true });
      return {
        ok: true,
        generation: snapshot.generation,
        cached: snapshot.credential !== null,
        pending: await pendingRetries(env, request.hostId),
      };
    }
    case "session-start": {
      const result = await outcome(plane.startSession(request.userId, request.hostId, request.authSessionHash));
      return result.ok ? { ok: true, sessionId: result.value.sessionId, expiresAt: result.value.expiresAt } : result;
    }
    case "session-ticket": {
      const result = await outcome(
        plane.issueSessionTicket(
          request.userId,
          request.sessionId,
          "probe-client-public-key",
          undefined,
          request.signedInTokenHash,
        ),
      );
      return result.ok ? { ok: true, authEpoch: ticketEpoch(result.value.ticket) } : result;
    }
    case "end-session": {
      const result = await outcome(plane.endSession(request.userId, request.sessionId));
      return result.ok ? { ok: true } : result;
    }
    case "revoke-sign-in": {
      await env.DB.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ?")
        .bind(request.at, request.tokenHash)
        .run();
      return { ok: true };
    }
    case "validate-batch": {
      const result = await outcome(plane.validateResumeClaimsBatch(request.claims));
      return result.ok ? { ok: true, valid: result.value } : result;
    }
    case "session-open": {
      const result = await outcome(plane.sessionOpen(request.hostId, request.sessionId));
      return result.ok ? { ok: true, open: result.value } : result;
    }
    case "list-hosts": {
      const result = await outcome(plane.listHosts(request.userId));
      return result.ok ? { ok: true, hosts: result.value } : result;
    }
    case "license-changed": {
      await env.DB.prepare("UPDATE licenses SET users = ?, updated_at = updated_at + 1 WHERE user_id = ?")
        .bind(request.users, request.ownerUserId)
        .run();
      const result = await outcome(plane.licenseChanged(request.ownerUserId));
      return result.ok ? { ok: true } : result;
    }
    case "minute-cron": {
      const result = await outcome(
        retryPendingHostStateInvalidations(
          { DB: database, HOST_STATE: env.HOST_STATE, HOST_STATE_MODE: options.mode },
          options.clock,
        ),
      );
      return result.ok ? { ok: true, pending: await pendingRetries(env) } : result;
    }
    case "host-state-retry": {
      const result = await outcome(
        deliverPendingRemoteAuthEvents(
          { DB: database, HOST_STATE: env.HOST_STATE, HOST_STATE_MODE: options.mode },
          options.clock,
        ),
      );
      return result.ok ? { ok: true, pending: await pendingRetries(env) } : result;
    }
  }
}

export default {
  async fetch(request: Request, env: ProbeEnv): Promise<Response> {
    const body = await request.json<{ options: ProbeOptions; request: ProbeRequest }>();
    const calls: D1Call[] = [];
    const count: D1Count = { rowsRead: 0 };
    const database = countedDatabase(env.DB, calls, count);
    const plane = new RemoteControlPlane(
      {
        DB: database,
        REMOTE_TICKET_PRIVATE_JWK: env.REMOTE_TICKET_PRIVATE_JWK,
        REMOTE_TICKET_PUBLIC_JWKS: env.REMOTE_TICKET_PUBLIC_JWKS,
        REMOTE_TICKET_KEY_ID: env.REMOTE_TICKET_KEY_ID,
        REMOTE_SIGNAL_URL: "wss://signal.probe.test",
        HOST_STATE_MODE: body.options.mode,
      },
      {
        now: () => body.options.clock,
        schedule: () => undefined,
        fetch: async () => new Response(null, { status: 200 }),
        hostState: probeHostState(env, body.options),
      },
    );
    const result = await run(plane, body.request, env, body.options, database);
    return Response.json({ ...result, d1: calls, rowsRead: count.rowsRead });
  },
};
