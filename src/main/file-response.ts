import { open } from "node:fs/promises";
import { Effect } from "effect";
import { RemoteWorkflowError, remoteCall, runRemoteWorkflow } from "./remote-service-effects";

const CHUNK_BYTES = 64 * 1_024;

/** Streams a file without keeping its whole contents in memory. Open failures still let the caller answer 404. */
export const fileResponse = Effect.fn("FileResponse.open")(function* (path: string, headers: Record<string, string>) {
  // The response stream owns the handle after construction. Before that, the operation owns it.
  let transferred = false;
  return yield* Effect.acquireUseRelease(
    remoteCall(() => open(path, "r")),
    (file) =>
      Effect.gen(function* () {
        const close = Effect.fn("FileResponse.close")(() => remoteCall(() => file.close()));
        const stats = yield* remoteCall(() => file.stat());
        if (!stats.isFile()) return yield* new RemoteWorkflowError({ cause: new Error("Not a regular file.") });
        const pull = Effect.fn("FileResponse.read")(function* (
          controller: ReadableStreamDefaultController<Uint8Array>,
        ) {
          const chunk = new Uint8Array(CHUNK_BYTES);
          const { bytesRead } = yield* remoteCall(() => file.read(chunk, 0, CHUNK_BYTES, null));
          if (bytesRead === 0) {
            controller.close();
            yield* close();
            return;
          }
          controller.enqueue(chunk.subarray(0, bytesRead));
        });
        const body = new ReadableStream<Uint8Array>({
          pull: (controller) =>
            runRemoteWorkflow(
              pull(controller).pipe(
                Effect.catch((error) =>
                  Effect.gen(function* () {
                    controller.error(error.cause);
                    yield* close().pipe(Effect.catch(() => Effect.void));
                  }),
                ),
              ),
            ),
          cancel: () => runRemoteWorkflow(close()),
        });
        // Media elements need the length to show a duration.
        const response = new Response(body, { headers: { ...headers, "Content-Length": String(stats.size) } });
        transferred = true;
        return response;
      }),
    (file) => (transferred ? Effect.void : remoteCall(() => file.close()).pipe(Effect.catch(() => Effect.void))),
  );
});
