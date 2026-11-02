import { appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RemoteRequestRecord, RemoteSyncProfileSink } from "@openbot/team-client/sync-profile";
import { Effect, Semaphore } from "effect";

const FILE_NAME = "dev-sync-profile.ndjson";

/**
 * The request records of `bun run perf:remote`, for an unpackaged build started with
 * `OPENBOT_DEV_SYNC_PROFILE=1`. The file is in the profile root, outside `logs`, and no export or
 * report reads it. Each start begins an empty file, so it holds the requests of this process only.
 * A `start` line marks each request that went out and an `end` line holds its record, so the
 * harness can tell when no request is in flight. The first line holds the epoch time the process
 * started and the added `OPENBOT_DEV_RTT_MS`, so the harness can time a start and check its latency.
 */
export function remoteSyncProfileFile(input: {
  isPackaged: boolean;
  setting: string | undefined;
  userData: string;
  roundTripMs: number;
}): RemoteSyncProfileSink | null {
  if (input.isPackaged || input.setting !== "1") return null;
  const path = join(input.userData, FILE_NAME);
  const writes = Semaphore.makeUnsafe(1);
  const write = (operation: () => Promise<void>) =>
    Effect.runFork(writes.withPermit(Effect.tryPromise(operation).pipe(Effect.ignore)));
  const processLine = { event: "process", startedAt: performance.timeOrigin, roundTripMs: input.roundTripMs };
  write(() => writeFile(path, `${JSON.stringify(processLine)}\n`));
  return {
    started() {
      write(() => appendFile(path, `${JSON.stringify({ event: "start" })}\n`));
    },
    push(record: RemoteRequestRecord) {
      write(() => appendFile(path, `${JSON.stringify({ event: "end", ...record })}\n`));
    },
  };
}
