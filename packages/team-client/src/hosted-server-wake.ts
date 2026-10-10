import {
  type HostedServerState,
  parseHostedServerStatus,
  parseHostedServerSummary,
} from "@openbot/contracts/hosted-servers";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { referenceFrom } from "@openbot/user-errors/reference";
import { Deferred, Effect, Schema } from "effect";

/** The account server answered, but its body could not be read. */
class HostedServerWakeError extends Schema.TaggedError<HostedServerWakeError>()("HostedServerWakeError", {
  status: Schema.Number,
  code: Schema.NullOr(Schema.String),
  reference: Schema.NullOr(Schema.String),
}) {
  constructor(status: number, code: string | null = null) {
    super({ status, code, reference: referenceFrom("boat", "wake", status, code) });
  }
}

/**
 * A hosted server in one of these states comes online without a user action, so the client reconnects.
 * A `running` server whose host is offline is still starting OpenBot, or it restarts.
 */
export const WAKE_RECONNECT_STATES: ReadonlySet<HostedServerState> = new Set([
  "creating",
  "starting",
  "waking",
  "running",
]);
/** The reconnects for one start. With the 5 second delay of the caller, this is about 5 minutes. */
const MAX_WAKE_ATTEMPTS = 60;
/** A host that is not a hosted server stays so. It is asked again after this long, not on each failure. */
const NOT_HOSTED_RECHECK_MS = 10 * 60_000;
/** A failure after this long with no wake request is a new outage, so its reconnects count from zero. */
const NEW_OUTAGE_MS = 2 * 60_000;
/** The delay between a wake reply and the next connection attempt. */
export const WAKE_RECONNECT_DELAY_MS = 5_000;
/** A sleeping or ended server is asked again after this long, not on each failed connection. */
const STATUS_RECHECK_MS = 60_000;
/** The error code of the account server for a host that is not a hosted server of this account. */
const NOT_FOUND_CODE = "hosted_server_not_found";

/**
 * Why a hosted server is not reachable. `sleeping`: the Worker stopped it because nobody used it, so the
 * client waits for the user's next input. `waking`: the client asked for a start and reconnects.
 * `offline`: the account server did not answer, so neither applies.
 */
export type HostedServerAvailability = "not_hosted" | "sleeping" | "ended" | "waking" | "offline";

export interface HostedServerUnavailableOptions {
  /** False when the client must not start the server now, for example a server that is not selected. */
  wake?: boolean;
}

export interface HostedServerWakeOptions {
  /** True for a start that the user asked for: the reconnect count of an earlier outage does not apply. */
  fresh?: boolean;
}

/** The part of a fetch response that a wake reads. The web and the mobile fetch both give it. */
export interface HostedServerWakeResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/**
 * Starts a stopped hosted server when a connection to it fails. `requestWake` posts to the account
 * server's `/v2/hosting/servers/<hostId>/wake`, which answers 404 for any other host, so a client
 * can ask for each offline host. It returns true while the server starts or runs, so the caller
 * reconnects until the host is online. It returns false when the server does not start by itself,
 * or after `MAX_WAKE_ATTEMPTS` replies in one outage.
 */
export function createHostedServerWake<E, R>(
  requestWake: (hostId: string) => Effect.Effect<HostedServerWakeResponse, E, R>,
  now: () => number = Date.now,
) {
  const notHostedAt = new Map<string, number>();
  /** The reconnect replies in a row for each host, and when the last one came. */
  const attempts = new Map<string, { count: number; at: number }>();
  /** When the reconnects of a host stopped at the limit. The host is asked again after the recheck time. */
  const gaveUpAt = new Map<string, number>();
  /** A failed connection reports itself twice, so both reports share one request. */
  const pending = new Map<string, Deferred.Deferred<boolean>>();

  return Effect.fn("HostedServerWake.wake")(function* (hostId: string, options: HostedServerWakeOptions = {}) {
    if (options.fresh) {
      attempts.delete(hostId);
      gaveUpAt.delete(hostId);
    }
    const current = pending.get(hostId);
    if (current) return yield* Deferred.await(current);
    const result = Deferred.makeUnsafe<boolean>();
    pending.set(hostId, result);
    return yield* Effect.gen(function* () {
      const time = now();
      const checked = notHostedAt.get(hostId);
      if (checked !== undefined && time - checked < NOT_HOSTED_RECHECK_MS) return false;
      const stopped = gaveUpAt.get(hostId);
      if (stopped !== undefined && time - stopped < NOT_HOSTED_RECHECK_MS) return false;
      const response = yield* requestWake(hostId).pipe(Effect.catch(() => Effect.succeed(null)));
      // A network failure is also the reason the host is offline; the next failure asks again.
      if (!response) return false;
      if (!response.ok) {
        attempts.delete(hostId);
        // Not a hosted server of this account, or a server whose plan ended: a wake cannot start it.
        // Any other failure can pass, so the next failure asks again.
        if (response.status === 404) notHostedAt.set(hostId, time);
        if (response.status === 402) gaveUpAt.set(hostId, time);
        return false;
      }
      const value = yield* Effect.tryPromise({
        try: () => response.json(),
        catch: () => new HostedServerWakeError(response.status),
      }).pipe(Effect.catch(() => Effect.succeed(null)));
      const server = parseHostedServerSummary(value);
      if (!server || !WAKE_RECONNECT_STATES.has(server.state)) {
        attempts.delete(hostId);
        return false;
      }
      const last = attempts.get(hostId);
      const previous = last && time - last.at < NEW_OUTAGE_MS ? last.count : 0;
      if (previous >= MAX_WAKE_ATTEMPTS) {
        attempts.delete(hostId);
        gaveUpAt.set(hostId, time);
        return false;
      }
      attempts.set(hostId, { count: previous + 1, at: time });
      return true;
    }).pipe(
      Effect.onExit((exit) =>
        Deferred.done(result, exit).pipe(Effect.tap(() => Effect.sync(() => pending.delete(hostId)))),
      ),
    );
  }, Effect.uninterruptible);
}

export type HostedServerWake<R = never> = (
  hostId: string,
  options?: HostedServerWakeOptions,
) => Effect.Effect<boolean, never, R>;

/**
 * Asks the account server whether an unreachable hosted server sleeps before it starts it. A client that
 * started each unreachable server would start a sleeping server again while nobody uses it. `requestStatus`
 * gets `/v2/hosting/servers/<hostId>/status`. An account server without that route answers 404 with no
 * error code, and then the client starts the server as before.
 */
export function createHostedServerStatusCheck<E, R>(
  requestStatus: (hostId: string) => Effect.Effect<HostedServerWakeResponse, E, R>,
  wake: HostedServerWake<R>,
  now: () => number = Date.now,
) {
  /** A result that does not change soon, and when it came. */
  const known = new Map<string, { result: "not_hosted" | "sleeping" | "ended"; at: number }>();
  const pending = new Map<string, Deferred.Deferred<HostedServerAvailability>>();

  const check = Effect.fn("HostedServerWake.checkStatus")(function* (
    hostId: string,
    startServer: boolean,
  ): Effect.fn.Return<HostedServerAvailability, never, R> {
    const time = now();
    const last = known.get(hostId);
    const recheck = last?.result === "not_hosted" ? NOT_HOSTED_RECHECK_MS : STATUS_RECHECK_MS;
    if (last && time - last.at < recheck) return last.result;
    const response = yield* requestStatus(hostId).pipe(Effect.catch(() => Effect.succeed(null)));
    if (!response) return "offline";
    if (response.status === 404) {
      const body = yield* Effect.tryPromise({
        try: () => response.json(),
        catch: () => new HostedServerWakeError(response.status),
      }).pipe(Effect.catch(() => Effect.succeed(null)));
      if (errorCode(body) === NOT_FOUND_CODE) return remember(hostId, "not_hosted", time);
      return startServer && (yield* wake(hostId)) ? "waking" : "offline";
    }
    if (!response.ok) return "offline";
    const status = parseHostedServerStatus(
      yield* Effect.tryPromise({
        try: () => response.json(),
        catch: () => new HostedServerWakeError(response.status),
      }).pipe(Effect.catch(() => Effect.succeed(null))),
    );
    if (!status) return "offline";
    if (status.sleeping) return remember(hostId, "sleeping", time);
    if (status.error === "plan_ended") return remember(hostId, "ended", time);
    known.delete(hostId);
    // A server that should run and does not answer stopped for another reason, or still starts.
    return startServer && (yield* wake(hostId)) ? "waking" : "offline";
  });

  return {
    /**
     * A connection to the host failed. Starts the server only when it does not sleep and `wake` is not
     * false. A server that the client does not start is `offline`.
     */
    unavailable: Effect.fn("HostedServerWake.unavailable")(function* (
      hostId: string,
      options: HostedServerUnavailableOptions = {},
    ) {
      const startServer = options.wake ?? true;
      const key = `${startServer}:${hostId}`;
      const current = pending.get(key);
      if (current) return yield* Deferred.await(current);
      const result = Deferred.makeUnsafe<HostedServerAvailability>();
      pending.set(key, result);
      return yield* check(hostId, startServer).pipe(
        Effect.onExit((exit) =>
          Deferred.done(result, exit).pipe(Effect.tap(() => Effect.sync(() => pending.delete(key)))),
        ),
      );
    }, Effect.uninterruptible),
    /** The user acted in the app while the server sleeps. Returns true while it starts. */
    wakeForInput: Effect.fn("HostedServerWake.wakeForInput")(function* (hostId: string) {
      known.delete(hostId);
      return yield* wake(hostId, { fresh: true });
    }),
    /** The client started the server another way, so the stored result is out of date. */
    forget(hostId: string): void {
      known.delete(hostId);
    },
  };

  function remember<T extends "not_hosted" | "sleeping" | "ended">(hostId: string, result: T, at: number): T {
    known.set(hostId, { result, at });
    return result;
  }
}

function errorCode(body: unknown): string | null {
  if (!isDynamicRecord(body) || !isDynamicRecord(body.error)) return null;
  return typeof body.error.code === "string" ? body.error.code : null;
}
