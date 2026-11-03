import { open } from "node:fs/promises";
import { Effect } from "effect";
import { runCauseEffect } from "../backend/effect-boundary";
import { RemoteWorkflowError, remoteCall } from "./remote-service-effects";

const CHUNK_BYTES = 64 * 1_024;

/**
 * The bytes that one `bytes=` range asks for, `"unsatisfiable"` when they are all after the end of the
 * file, or `null` for the whole file. Multiple ranges and malformed values get the whole file.
 */
function byteRange(header: string | null, size: number): { start: number; end: number } | "unsatisfiable" | null {
  const [, first = "", last = ""] = /^bytes=(\d*)-(\d*)$/u.exec(header ?? "") ?? [];
  if (first === "" && last === "") return null;
  if (first !== "" && last !== "" && Number(last) < Number(first)) return null;
  const start = first === "" ? Math.max(0, size - Number(last)) : Number(first);
  const end = first === "" || last === "" ? size - 1 : Math.min(Number(last), size - 1);
  return start > end ? "unsatisfiable" : { start, end };
}

/**
 * Streams a file as the answer to `request`, without keeping its whole contents in memory. Open failures still
 * let the caller answer 404. A `Range` gets 206: media elements need it to seek, and to read an MP4 index at
 * the end of the file.
 */
export const fileResponse = Effect.fn("FileResponse.open")(function* (
  path: string,
  request: Request,
  headers: Record<string, string>,
) {
  // The response stream owns the handle after construction. Before that, the operation owns it.
  let transferred = false;
  return yield* Effect.acquireUseRelease(
    remoteCall(() => open(path, "r")),
    (file) =>
      Effect.gen(function* () {
        const close = Effect.fn("FileResponse.close")(() => remoteCall(() => file.close()));
        const stats = yield* remoteCall(() => file.stat());
        if (!stats.isFile()) return yield* new RemoteWorkflowError({ cause: new Error("Not a regular file.") });
        const requested = byteRange(request.headers.get("Range"), stats.size);
        if (requested === "unsatisfiable") {
          return new Response(null, {
            status: 416,
            headers: { ...headers, "Accept-Ranges": "bytes", "Content-Range": `bytes */${stats.size}` },
          });
        }
        const { start, end } = requested ?? { start: 0, end: stats.size - 1 };
        let position = start;
        const pull = Effect.fn("FileResponse.read")(function* (
          controller: ReadableStreamDefaultController<Uint8Array>,
        ) {
          const chunk = new Uint8Array(CHUNK_BYTES);
          const length = Math.min(CHUNK_BYTES, end + 1 - position);
          const { bytesRead } =
            length > 0 ? yield* remoteCall(() => file.read(chunk, 0, length, position)) : { bytesRead: 0 };
          if (bytesRead === 0) {
            controller.close();
            yield* close();
            return;
          }
          position += bytesRead;
          controller.enqueue(chunk.subarray(0, bytesRead));
        });
        const body = new ReadableStream<Uint8Array>({
          pull: (controller) =>
            runCauseEffect(
              pull(controller).pipe(
                Effect.catch((error) =>
                  Effect.gen(function* () {
                    controller.error(error.cause);
                    yield* close().pipe(Effect.catch(() => Effect.void));
                  }),
                ),
              ),
            ),
          cancel: () => runCauseEffect(close()),
        });
        // Media elements need the length to show a duration.
        const response = new Response(body, {
          status: requested ? 206 : 200,
          headers: {
            ...headers,
            "Accept-Ranges": "bytes",
            "Content-Length": String(end + 1 - start),
            ...(requested ? { "Content-Range": `bytes ${start}-${end}/${stats.size}` } : {}),
          },
        });
        transferred = true;
        return response;
      }),
    (file) => (transferred ? Effect.void : remoteCall(() => file.close()).pipe(Effect.catch(() => Effect.void))),
  );
});
