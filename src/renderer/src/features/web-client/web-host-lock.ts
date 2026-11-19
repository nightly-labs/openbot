import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { currentText } from "@openbot/ui/text";

export class WebHostOtherTabError extends Error {
  constructor() {
    super(currentText().t("webClient.error.otherTab"));
  }
}

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

export type WebHostState = "unknown" | "connecting" | "online" | "offline" | "error" | "incompatible";

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

export function openWebHostChannel(accountId: string): BroadcastChannel | null {
  return typeof BroadcastChannel === "function" ? new BroadcastChannel(`openbot.web.hosts:${accountId}`) : null;
}

export async function acquireOpenedWebHostLock(
  accountId: string,
  hostId: string,
  channel: BroadcastChannel | null,
  acquire: typeof acquireWebHostLock = acquireWebHostLock,
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
