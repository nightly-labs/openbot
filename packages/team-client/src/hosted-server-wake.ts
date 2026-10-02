import {
  type HostedServerState,
  parseHostedServerStatus,
  parseHostedServerSummary,
} from "@openbot/contracts/hosted-servers";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";

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
export function createHostedServerWake(
  requestWake: (hostId: string) => Promise<HostedServerWakeResponse>,
  now: () => number = Date.now,
) {
  const notHostedAt = new Map<string, number>();
  /** The reconnect replies in a row for each host, and when the last one came. */
  const attempts = new Map<string, { count: number; at: number }>();
  /** When the reconnects of a host stopped at the limit. The host is asked again after the recheck time. */
  const gaveUpAt = new Map<string, number>();
  /** A failed connection reports itself twice, so both reports share one request. */
  const pending = new Map<string, Promise<boolean>>();

  return function wake(hostId: string, options: HostedServerWakeOptions = {}): Promise<boolean> {
    if (options.fresh) {
      attempts.delete(hostId);
      gaveUpAt.delete(hostId);
    }
    const current = pending.get(hostId);
    if (current) return current;
    const request = wakeOnce(hostId).finally(() => pending.delete(hostId));
    pending.set(hostId, request);
    return request;
  };

  async function wakeOnce(hostId: string): Promise<boolean> {
    const time = now();
    const checked = notHostedAt.get(hostId);
    if (checked !== undefined && time - checked < NOT_HOSTED_RECHECK_MS) return false;
    const stopped = gaveUpAt.get(hostId);
    if (stopped !== undefined && time - stopped < NOT_HOSTED_RECHECK_MS) return false;
    let response: HostedServerWakeResponse;
    try {
      response = await requestWake(hostId);
    } catch {
      // A network failure is also the reason the host is offline; the next failure asks again.
      return false;
    }
    if (!response.ok) {
      attempts.delete(hostId);
      // Not a hosted server of this account, or a server whose plan ended: a wake cannot start it.
      // Any other failure can pass, so the next failure asks again.
      if (response.status === 404) notHostedAt.set(hostId, time);
      if (response.status === 402) gaveUpAt.set(hostId, time);
      return false;
    }
    const server = parseHostedServerSummary(await response.json().catch(() => null));
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
  }
}

export type HostedServerWake = ReturnType<typeof createHostedServerWake>;

/**
 * Asks the account server whether an unreachable hosted server sleeps before it starts it. A client that
 * started each unreachable server would start a sleeping server again while nobody uses it. `requestStatus`
 * gets `/v2/hosting/servers/<hostId>/status`. An account server without that route answers 404 with no
 * error code, and then the client starts the server as before.
 */
export function createHostedServerStatusCheck(
  requestStatus: (hostId: string) => Promise<HostedServerWakeResponse>,
  wake: HostedServerWake,
  now: () => number = Date.now,
) {
  /** A result that does not change soon, and when it came. */
  const known = new Map<string, { result: "not_hosted" | "sleeping" | "ended"; at: number }>();
  const pending = new Map<string, Promise<HostedServerAvailability>>();

  return {
    /**
     * A connection to the host failed. Starts the server only when it does not sleep and `wake` is not
     * false. A server that the client does not start is `offline`.
     */
    unavailable(hostId: string, options: HostedServerUnavailableOptions = {}): Promise<HostedServerAvailability> {
      const startServer = options.wake ?? true;
      const key = `${startServer}:${hostId}`;
      const current = pending.get(key);
      if (current) return current;
      const request = check(hostId, startServer).finally(() => pending.delete(key));
      pending.set(key, request);
      return request;
    },
    /** The user acted in the app while the server sleeps. Returns true while it starts. */
    wakeForInput(hostId: string): Promise<boolean> {
      known.delete(hostId);
      return wake(hostId, { fresh: true });
    },
    /** The client started the server another way, so the stored result is out of date. */
    forget(hostId: string): void {
      known.delete(hostId);
    },
  };

  async function check(hostId: string, startServer: boolean): Promise<HostedServerAvailability> {
    const time = now();
    const last = known.get(hostId);
    const recheck = last?.result === "not_hosted" ? NOT_HOSTED_RECHECK_MS : STATUS_RECHECK_MS;
    if (last && time - last.at < recheck) return last.result;
    let response: HostedServerWakeResponse;
    try {
      response = await requestStatus(hostId);
    } catch {
      return "offline";
    }
    if (response.status === 404) {
      const body = await response.json().catch(() => null);
      if (errorCode(body) === NOT_FOUND_CODE) return remember(hostId, "not_hosted", time);
      return startServer && (await wake(hostId)) ? "waking" : "offline";
    }
    if (!response.ok) return "offline";
    const status = parseHostedServerStatus(await response.json().catch(() => null));
    if (!status) return "offline";
    if (status.sleeping) return remember(hostId, "sleeping", time);
    if (status.error === "plan_ended") return remember(hostId, "ended", time);
    known.delete(hostId);
    // A server that should run and does not answer stopped for another reason, or still starts.
    return startServer && (await wake(hostId)) ? "waking" : "offline";
  }

  function remember<T extends "not_hosted" | "sleeping" | "ended">(hostId: string, result: T, at: number): T {
    known.set(hostId, { result, at });
    return result;
  }
}

function errorCode(body: unknown): string | null {
  if (!isDynamicRecord(body) || !isDynamicRecord(body.error)) return null;
  return typeof body.error.code === "string" ? body.error.code : null;
}
