import { Effect } from "effect";

let restoring: () => boolean = () => false;

export const DISK_RESTORE_WAIT_MS = 120_000;

export function setDiskRestoreProbe(probe: () => boolean): void {
  restoring = probe;
}

export function diskRestoring(): boolean {
  return restoring();
}

export function providerCheckTimeoutMs(timeoutMs: number): number {
  return restoring() ? Math.max(timeoutMs, DISK_RESTORE_WAIT_MS) : timeoutMs;
}

const RESTORE_END_WAIT_MS = 600_000;

export const diskRestoreEnded: Effect.Effect<void> = Effect.gen(function* () {
  const deadline = Date.now() + RESTORE_END_WAIT_MS;
  while (restoring() && Date.now() < deadline) yield* Effect.sleep("2 seconds");
});
