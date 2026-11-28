import { Effect } from "effect";
import type { HostState, HostStateCopy, HostStateFill, HostStateQuery, HostStateSnapshot } from "./host-state-object";

export type HostStateMode = "off" | "write" | "read";

export const HOST_STATE_RECHECK_MS = 10 * 60_000;
export const HOST_STATE_SIGN_IN_RECHECK_MS = 60_000;
const HOST_STATE_CALL_LIMIT = "1 second";

type HostStateOperation = "read" | "fill" | "invalidate";

export interface HostStateStore {
  readonly mode: Exclude<HostStateMode, "off">;
  read(hostId: string, query: HostStateQuery): Effect.Effect<HostStateSnapshot | null>;
  fill(hostId: string, generation: number, now: number, entries: HostStateFill): Effect.Effect<void>;
  invalidate(hostId: string): Effect.Effect<boolean>;
}

export function hostStateMode(value: string | undefined): HostStateMode {
  const mode = value?.trim();
  return mode === "read" || mode === "write" ? mode : "off";
}

export function hostCopyFresh<Value>(
  copy: HostStateCopy<Value> | null | undefined,
  now: number,
  limit: number = HOST_STATE_RECHECK_MS,
): copy is HostStateCopy<Value> {
  return copy !== null && copy !== undefined && copy.checkedAt <= now && now - copy.checkedAt < limit;
}

function hostStateCall<A>(operation: HostStateOperation, call: () => Promise<A>): Effect.Effect<A | null> {
  return Effect.tryPromise(call).pipe(
    Effect.timeout(HOST_STATE_CALL_LIMIT),
    Effect.catch(() =>
      Effect.sync(() => {
        console.error("Host state call failed:", operation);
        return null;
      }),
    ),
  );
}

export function hostStateStore(
  namespace: DurableObjectNamespace<HostState> | undefined,
  flag: string | undefined,
): HostStateStore | null {
  const mode = hostStateMode(flag);
  if (mode === "off" || !namespace) return null;
  const stub = (hostId: string) => namespace.get(namespace.idFromName(hostId));
  return {
    mode,
    read: (hostId, query) => hostStateCall("read", () => stub(hostId).read(query)),
    fill: (hostId, generation, now, entries) =>
      hostStateCall("fill", () => stub(hostId).fill(generation, now - HOST_STATE_RECHECK_MS, entries)).pipe(
        Effect.asVoid,
      ),
    invalidate: (hostId) =>
      hostStateCall("invalidate", () => stub(hostId).invalidate()).pipe(
        Effect.map((generation) => generation !== null),
      ),
  };
}
