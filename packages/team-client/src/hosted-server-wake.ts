import {
  type HostedServerError,
  type HostedServerState,
  parseHostedServerStatus,
  parseHostedServerSummary,
} from "@openbot/contracts/hosted-servers";
import type { HostedServerStartStep } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Deferred, Effect, Schema } from "effect";

class HostedServerWakeError extends Schema.TaggedError<HostedServerWakeError>()("HostedServerWakeError", {}) {}

/**
 * A hosted server in one of these states comes online without a user action, so the client reconnects.
 * A `running` server whose host is offline is still starting OpenBot, or it restarts. A wake reply is
 * `stopping` only for a server that must run (a restart, a resize, or a provider stop): the account
 * server starts it again after the stop.
 */
export const WAKE_RECONNECT_STATES: ReadonlySet<HostedServerState> = new Set([
  "creating",
  "starting",
  "waking",
  "running",
  "stopping",
]);
/**
 * How long a client waits for the host of a `running` server to connect. The account server sees only the
 * machine, not OpenBot on it, and the host retries its own sign-in for longer than 5 minutes
 * (`src/main/hosted-server-start-retry.ts`). A machine that still starts has no limit.
 */
export const HOSTED_HOST_READY_LIMIT_MS = 15 * 60_000;
/** While a hosted server starts, the client reads its state this often, to show the step. */
export const HOSTED_START_POLL_MS = 30_000;
/**
 * A start whose state the client cannot read this many times in a row ends, as a start that took too
 * long. With `HOSTED_START_POLL_MS`, this is 5 minutes.
 */
export const HOSTED_START_FAILED_READS = 10;
/** A host that is not a hosted server stays so. It is asked again after this long, not on each failure. */
const NOT_HOSTED_RECHECK_MS = 10 * 60_000;
/** A failure after this long with no wake request is a new outage, so its wait for the host starts again. */
const NEW_OUTAGE_MS = 2 * 60_000;
/**
 * The step of a start that the account server reports, or null when the server does not start by itself.
 * A server whose plan ended stops, also from a start state. A `stopped` server with no error must run (the
 * caller checks that it does not sleep): the account server starts it again, at once after a wake.
 */
export function hostedStartStep(server: {
  state: HostedServerState;
  error: HostedServerError | null;
}): HostedServerStartStep | null {
  if (server.state === "stopped") return server.error === null ? "machine" : null;
  if (!WAKE_RECONNECT_STATES.has(server.state) || server.error === "plan_ended") return null;
  if (server.state === "running") return "openbot";
  return server.state === "waking" && server.error === "provider_limit" ? "provider_limit" : "machine";
}
/** The delay between a wake reply and the next connection attempt. */
export const WAKE_RECONNECT_DELAY_MS = 5_000;
/** A sleeping or ended server is asked again after this long, not on each failed connection. */
const STATUS_RECHECK_MS = 60_000;
/**
 * A status check asks again about a host that is not a hosted server only after this long. The account
 * server gives a new hosted server a new random ID, so a host ID that is not hosted stays so. The account
 * directory keeps hosts that went away for good, and each one retries each 5 or 15 minutes, so a shorter
 * time sent one status request for each retry. A wake or a restart from the user clears the result.
 */
const NOT_HOSTED_STATUS_RECHECK_MS = 6 * 60 * 60_000;
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
  /** True for a start that the user asked for: the wait of an earlier outage does not apply. */
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
 * or when the server ran for `HOSTED_HOST_READY_LIMIT_MS` in one outage and its host did not connect.
 */
export function createHostedServerWake<E, R>(
  requestWake: (hostId: string) => Effect.Effect<HostedServerWakeResponse, E, R>,
  now: () => number = Date.now,
) {
  const notHostedAt = new Map<string, number>();
  /** For each host: when the server was first `running` in this outage (null before), and the last reply. */
  const attempts = new Map<string, { runningSince: number | null; at: number }>();
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
        catch: () => new HostedServerWakeError({}),
      }).pipe(Effect.catch(() => Effect.succeed(null)));
      const server = parseHostedServerSummary(value);
      if (!server || !WAKE_RECONNECT_STATES.has(server.state)) {
        attempts.delete(hostId);
        return false;
      }
      const last = attempts.get(hostId);
      const since = last && time - last.at < NEW_OUTAGE_MS ? last.runningSince : null;
      // Only the host start has a limit. A machine that still starts, or waits after a rate limit, does not.
      const runningSince = server.state === "running" ? (since ?? time) : null;
      if (runningSince !== null && time - runningSince >= HOSTED_HOST_READY_LIMIT_MS) {
        attempts.delete(hostId);
        gaveUpAt.set(hostId, time);
        return false;
      }
      attempts.set(hostId, { runningSince, at: time });
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
    const recheck = last?.result === "not_hosted" ? NOT_HOSTED_STATUS_RECHECK_MS : STATUS_RECHECK_MS;
    if (last && time - last.at < recheck) return last.result;
    const response = yield* requestStatus(hostId).pipe(Effect.catch(() => Effect.succeed(null)));
    if (!response) return "offline";
    if (response.status === 404) {
      const body = yield* Effect.tryPromise({
        try: () => response.json(),
        catch: () => new HostedServerWakeError({}),
      }).pipe(Effect.catch(() => Effect.succeed(null)));
      if (errorCode(body) === NOT_FOUND_CODE) return remember(hostId, "not_hosted", time);
      return startServer && (yield* wake(hostId)) ? "waking" : "offline";
    }
    if (!response.ok) return "offline";
    const status = parseHostedServerStatus(
      yield* Effect.tryPromise({ try: () => response.json(), catch: () => new HostedServerWakeError({}) }).pipe(
        Effect.catch(() => Effect.succeed(null)),
      ),
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
