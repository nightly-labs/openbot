import { appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RemoteRequestRecord, RemoteSyncProfileSink } from "@openbot/team-client/sync-profile";
import { Effect, Semaphore } from "effect";

const FILE_NAME = "dev-sync-profile.ndjson";

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
