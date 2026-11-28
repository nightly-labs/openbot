import { Effect } from "effect";
import { decodeJwt } from "jose";
import { type HostStateStore, hostStateStore } from "../src/server/host-state";
import { HostState, type HostStateSnapshot } from "../src/server/host-state-object";
import { deliverPendingRemoteAuthEvents, RemoteControlPlane } from "../src/server/remote-control-plane";
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

export type ProbeRequest =
  | { op: "ticket"; hostId: string; token: string }
  | { op: "homes"; hostId: string; token: string }
  | { op: "rotate"; hostId: string; token: string; user: AuthUser; ownerMembershipId: string }
  | { op: "revoke-member"; hostId: string; actorUserId: string; membershipId: string }
  | { op: "revoke-host"; hostId: string; token: string; user: AuthUser }
  | { op: "state"; hostId: string }
  | { op: "host-state-retry" };

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

function countedStatements(source: D1Database | D1DatabaseSession, session: string, calls: D1Call[]) {
  return (sql: string) => {
    calls.push({ session, sql: compactSql(sql) });
    return source.prepare(sql);
  };
}

function countedDatabase(database: D1Database, calls: D1Call[]): D1Database {
  return {
    prepare: countedStatements(database, "primary", calls),
    batch: (statements) => database.batch(statements),
    exec: (query) => {
      calls.push({ session: "primary", sql: compactSql(query) });
      return database.exec(query);
    },
    withSession: (constraint) => {
      const session = database.withSession(constraint);
      const label = typeof constraint === "string" ? constraint : "unconstrained";
      return {
        prepare: countedStatements(session, label, calls),
        batch: (statements) => session.batch(statements),
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
    const database = countedDatabase(env.DB, calls);
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
    return Response.json({ ...result, d1: calls });
  },
};
