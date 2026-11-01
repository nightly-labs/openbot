import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { currentText } from "@openbot/ui/text";

/** Another tab of this browser has the host open. The host itself can be online. */
export class WebHostOtherTabError extends Error {
  constructor() {
    super(currentText().t("webClient.error.otherTab"));
  }
}

/**
 * A logical host session belongs to one account credential. Prevent tabs from replacing each other's peer.
 * With `wait`, the request queues until the lock is free or the signal aborts.
 */
export async function acquireWebHostLock(
  accountId: string,
  hostId: string,
  options: { wait?: AbortSignal } = {},
): Promise<() => void> {
  if (!navigator.locks) throw new Error(currentText().t("webClient.error.noLocks"));
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const lockOptions: LockOptions = options.wait ? { signal: options.wait } : { ifAvailable: true };
  return new Promise((resolve, reject) => {
    void navigator.locks
      .request(`openbot.web.host:${accountId}:${hostId}`, lockOptions, async (lock) => {
        if (!lock) {
          reject(new WebHostOtherTabError());
          return;
        }
        resolve(release);
        await held;
      })
      .catch(reject);
  });
}

/** The connection state that a tab reports for a host it holds. "unknown" before the first result. */
export type WebHostState = "unknown" | "connecting" | "online" | "offline" | "error" | "incompatible";

/**
 * The messages between the tabs of one account. A tab that opens a host asks the tab that holds it
 * for a status connection to let it go; a tab that has the host open answers `busy`. With `take`, the
 * user moves the host to the tab that asks, so every tab lets it go. A tab of an older build ignores `take`.
 */
export type WebHostTabMessage =
  | { type: "release"; hostId: string; requestId: string }
  | { type: "take"; hostId: string; requestId: string }
  | { type: "busy"; hostId: string; requestId: string }
  | { type: "state"; hostId: string; state: WebHostState }
  | { type: "query" };

const HOST_STATES = [
  "unknown",
  "connecting",
  "online",
  "offline",
  "error",
  "incompatible",
] as const satisfies readonly WebHostState[];

function isWebHostState(value: unknown): value is WebHostState {
  return HOST_STATES.some((state) => state === value);
}

export function decodeWebHostTabMessage(value: unknown): WebHostTabMessage | null {
  if (!isDynamicRecord(value)) return null;
  if (value.type === "query") return { type: "query" };
  if (!isString(value.hostId)) return null;
  if ((value.type === "release" || value.type === "take" || value.type === "busy") && isString(value.requestId))
    return { type: value.type, hostId: value.hostId, requestId: value.requestId };
  if (value.type === "state" && isWebHostState(value.state))
    return { type: "state", hostId: value.hostId, state: value.state };
  return null;
}

/** Null where the browser has no BroadcastChannel. Then no tab keeps status connections. */
export function openWebHostChannel(accountId: string): BroadcastChannel | null {
  return typeof BroadcastChannel === "function" ? new BroadcastChannel(`openbot.web.hosts:${accountId}`) : null;
}

/**
 * The lock of a host this tab opens. When another tab holds it, asks that tab to let its status
 * connection go and waits for the lock. A tab that has the host open refuses at once, unless `takeOver`
 * asks it to close the host.
 */
export async function acquireOpenedWebHostLock(
  accountId: string,
  hostId: string,
  channel: BroadcastChannel | null,
  acquire: typeof acquireWebHostLock = acquireWebHostLock,
  // The other tab ends its session before it gives up the lock, which is a request to the account service.
  timeoutMs = 15_000,
  takeOver = false,
): Promise<() => void> {
  try {
    return await acquire(accountId, hostId);
  } catch (error) {
    if (!channel || !navigator.locks) throw error;
  }
  const requestId = crypto.randomUUID();
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), timeoutMs);
  const listen = (event: MessageEvent) => {
    const message = decodeWebHostTabMessage(event.data);
    if (message?.type === "busy" && message.requestId === requestId) stop.abort();
  };
  channel.addEventListener("message", listen);
  try {
    channel.postMessage({ type: takeOver ? "take" : "release", hostId, requestId } satisfies WebHostTabMessage);
    return await acquire(accountId, hostId, { wait: stop.signal });
  } catch (error) {
    if (!stop.signal.aborted) throw error;
    throw new WebHostOtherTabError();
  } finally {
    clearTimeout(timer);
    channel.removeEventListener("message", listen);
  }
}
