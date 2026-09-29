import { type HostedServerState, parseHostedServerSummary } from "@openbot/contracts/hosted-servers";

/**
 * A hosted server in one of these states comes online without a user action, so the client reconnects.
 * A `running` server whose host is offline is still starting OpenBot, or it restarts.
 */
const WAKE_RECONNECT_STATES: ReadonlySet<HostedServerState> = new Set(["creating", "starting", "waking", "running"]);
/** The reconnects for one start. With the 5 second delay of the caller, this is about 5 minutes. */
const MAX_WAKE_ATTEMPTS = 60;
/** A host that is not a hosted server stays so. It is asked again after this long, not on each failure. */
const NOT_HOSTED_RECHECK_MS = 10 * 60_000;
/** A failure after this long with no wake request is a new outage, so its reconnects count from zero. */
const NEW_OUTAGE_MS = 2 * 60_000;
/** The delay between a wake reply and the next connection attempt. */
export const WAKE_RECONNECT_DELAY_MS = 5_000;

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

  return function wake(hostId: string): Promise<boolean> {
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
