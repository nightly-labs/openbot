import { Effect } from "effect";
import type { HostState, HostStateCredential, HostStateEntry } from "./host-state-object";

export type HostStateMode = "off" | "write" | "read";

export const HOST_STATE_RECHECK_MS = 60_000;
const HOST_STATE_CALL_LIMIT = "1 second";

type HostStateOperation = "read" | "fill" | "invalidate";

export interface HostStateStore {
  readonly mode: Exclude<HostStateMode, "off">;
  read(hostId: string): Effect.Effect<HostStateEntry | null>;
  fill(hostId: string, credential: HostStateCredential, checkedAt: number, generation: number): Effect.Effect<void>;
  invalidate(hostId: string): Effect.Effect<void>;
}

export function hostStateMode(value: string | undefined): HostStateMode {
  const mode = value?.trim();
  return mode === "read" || mode === "write" ? mode : "off";
}

export function hostCredentialFresh(
  entry: HostStateEntry,
  now: number,
): entry is HostStateEntry & {
  credential: HostStateCredential;
  checkedAt: number;
} {
  return (
    entry.credential !== null &&
    entry.checkedAt !== null &&
    entry.checkedAt <= now &&
    now - entry.checkedAt < HOST_STATE_RECHECK_MS
  );
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
    read: (hostId) => hostStateCall("read", () => stub(hostId).read()),
    fill: (hostId, credential, checkedAt, generation) =>
      hostStateCall("fill", () => stub(hostId).fill(credential, checkedAt, generation)).pipe(Effect.asVoid),
    invalidate: (hostId) => hostStateCall("invalidate", () => stub(hostId).invalidate()).pipe(Effect.asVoid),
  };
}
