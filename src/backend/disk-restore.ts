/**
 * A hosted server wakes from a snapshot that its host restores in the background. Until the restore
 * ends, the first read of each file waits for that file to arrive over the network, so a provider CLI
 * can take a minute to print its version or to answer `initialize`. A check with the local-disk limit
 * then reports a busy computer for a CLI that works.
 *
 * The main process sets the probe once at start. Everywhere else it answers `false`.
 */
import { Effect } from "effect";

let restoring: () => boolean = () => false;

/** The limit of a provider check while the disk is restored: a large CLI arrives in this time. */
export const DISK_RESTORE_WAIT_MS = 120_000;

export function setDiskRestoreProbe(probe: () => boolean): void {
  restoring = probe;
}

export function diskRestoring(): boolean {
  return restoring();
}

/** `timeoutMs`, or `DISK_RESTORE_WAIT_MS` when that is longer and the disk is being restored. */
export function providerCheckTimeoutMs(timeoutMs: number): number {
  return restoring() ? Math.max(timeoutMs, DISK_RESTORE_WAIT_MS) : timeoutMs;
}

/** The longest wait of `diskRestoreEnded`. A restore took about 3.5 minutes. */
const RESTORE_END_WAIT_MS = 600_000;

/**
 * Ends when the restore ends, or after 10 minutes. Work that can wait, such as an update check, then
 * does not take the network from the files that the start reads first.
 */
export const diskRestoreEnded: Effect.Effect<void> = Effect.gen(function* () {
  const deadline = Date.now() + RESTORE_END_WAIT_MS;
  while (restoring() && Date.now() < deadline) yield* Effect.sleep("2 seconds");
});
