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

export const WAKE_RECONNECT_STATES: ReadonlySet<HostedServerState> = new Set([
  "creating",
  "starting",
  "waking",
  "running",
  "stopping",
]);
export const HOSTED_HOST_READY_LIMIT_MS = 15 * 60_000;
export const HOSTED_START_POLL_MS = 30_000;
export const HOSTED_START_FAILED_READS = 10;
const NOT_HOSTED_RECHECK_MS = 10 * 60_000;
const NEW_OUTAGE_MS = 2 * 60_000;
export function hostedStartStep(server: {
  state: HostedServerState;
  error: HostedServerError | null;
}): HostedServerStartStep | null {
  if (server.state === "stopped") return server.error === null ? "machine" : null;
  if (!WAKE_RECONNECT_STATES.has(server.state) || server.error === "plan_ended") return null;
  if (server.state === "running") return "openbot";
  return server.state === "waking" && server.error === "provider_limit" ? "provider_limit" : "machine";
}
export const WAKE_RECONNECT_DELAY_MS = 5_000;
const STATUS_RECHECK_MS = 60_000;
const NOT_HOSTED_STATUS_RECHECK_MS = 6 * 60 * 60_000;
const NOT_FOUND_CODE = "hosted_server_not_found";

export type HostedServerAvailability = "not_hosted" | "sleeping" | "ended" | "waking" | "offline";

export interface HostedServerUnavailableOptions {
  wake?: boolean;
}

export interface HostedServerWakeOptions {
  fresh?: boolean;
}

export interface HostedServerWakeResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export function createHostedServerWake<E, R>(
  requestWake: (hostId: string) => Effect.Effect<HostedServerWakeResponse, E, R>,
  now: () => number = Date.now,
) {
  const notHostedAt = new Map<string, number>();
  const attempts = new Map<string, { runningSince: number | null; at: number }>();
  const gaveUpAt = new Map<string, number>();
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
      if (!response) return false;
      if (!response.ok) {
        attempts.delete(hostId);
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

export function createHostedServerStatusCheck<E, R>(
  requestStatus: (hostId: string) => Effect.Effect<HostedServerWakeResponse, E, R>,
  wake: HostedServerWake<R>,
  now: () => number = Date.now,
) {
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
    return startServer && (yield* wake(hostId)) ? "waking" : "offline";
  });

  return {
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
    wakeForInput: Effect.fn("HostedServerWake.wakeForInput")(function* (hostId: string) {
      known.delete(hostId);
      return yield* wake(hostId, { fresh: true });
    }),
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
