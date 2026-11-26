import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Worker } from "node:worker_threads";
import { Effect, Schema, Semaphore, Stream } from "effect";

class FileHashFailure extends Schema.TaggedError<FileHashFailure>()("FileHashFailure", {
  cause: Schema.Defect(),
}) {}

class HashWorkerUnavailable extends Schema.TaggedError<HashWorkerUnavailable>()("HashWorkerUnavailable", {
  cause: Schema.Defect(),
}) {}

const WORKER_MIN_BYTES = 4 * 1024 * 1024;

const workerPermits = Semaphore.makeUnsafe(2);

const HASH_WORKER_SOURCE = `
const { createHash } = require("node:crypto");
const { createReadStream } = require("node:fs");
const { parentPort, workerData } = require("node:worker_threads");
(async () => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(workerData)) hash.update(chunk);
  parentPort.postMessage(hash.digest("hex"));
})();
`;

const hashInline = Effect.fn("FileHash.inline")(function* (path: string) {
  const hash = createHash("sha256");
  yield* Effect.acquireUseRelease(
    Effect.sync(() => createReadStream(path)),
    (stream) =>
      Stream.fromAsyncIterable(stream, (cause) => new FileHashFailure({ cause })).pipe(
        Stream.runForEach((chunk) =>
          Effect.sync(() => {
            hash.update(chunk);
          }),
        ),
      ),
    (stream) =>
      Effect.sync(() => {
        stream.destroy();
      }),
  );
  return hash.digest("hex");
});

const hashInWorker = (path: string) =>
  workerPermits.withPermits(1)(
    Effect.callback<string, HashWorkerUnavailable>((resume) => {
      let worker: Worker;
      try {
        worker = new Worker(HASH_WORKER_SOURCE, { eval: true, workerData: path });
      } catch (cause) {
        resume(Effect.fail(new HashWorkerUnavailable({ cause })));
        return;
      }
      worker.once("message", (digest: unknown) =>
        resume(
          typeof digest === "string"
            ? Effect.succeed(digest)
            : Effect.fail(new HashWorkerUnavailable({ cause: digest })),
        ),
      );
      worker.once("error", (cause) => resume(Effect.fail(new HashWorkerUnavailable({ cause }))));
      worker.once("exit", (exitCode) => resume(Effect.fail(new HashWorkerUnavailable({ cause: exitCode }))));
      return Effect.promise(async () => {
        await worker.terminate();
      });
    }),
  );

export const sha256File = Effect.fn("FileHash.sha256")(function* (path: string) {
  const size = yield* Effect.tryPromise(() => stat(path)).pipe(
    Effect.map((info) => info.size),
    Effect.catch(() => Effect.succeed(0)),
  );
  if (size < WORKER_MIN_BYTES) return yield* hashInline(path);
  return yield* hashInWorker(path).pipe(Effect.catch(() => hashInline(path)));
});
