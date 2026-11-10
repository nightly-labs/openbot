import { open } from "node:fs/promises";
import { Effect } from "effect";
import { runCauseEffect } from "../backend/effect-boundary";
import { RemoteWorkflowError, remoteCall } from "./remote-service-effects";

const CHUNK_BYTES = 64 * 1_024;

/**
 * The bytes that one `bytes=` range asks for, `"unsatisfiable"` when they all lie after the end of the file, or
 * `null` for the whole file. Multiple ranges and malformed values get the whole file.
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
 * Streams a file without keeping its whole contents in memory. Open failures still let the caller answer 404.
 * A caller that gives `range` (the request's `Range` header, or `null`) gets a 206 for one byte range. Electron
 * lets a media element on a `stream` scheme continue from a byte offset, and it trusts the bytes that come back:
 * a full file from byte 0 stops the playback with a decode error (#6112).
 */
export const fileResponse = Effect.fn("FileResponse.open")(function* (
  path: string,
  headers: Record<string, string>,
  range?: string | null,
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
        const requested = range === undefined ? null : byteRange(range, stats.size);
        const rangeHeaders: Record<string, string> = range === undefined ? {} : { "Accept-Ranges": "bytes" };
        if (requested === "unsatisfiable") {
          return new Response(null, {
            status: 416,
            headers: { ...headers, ...rangeHeaders, "Content-Range": `bytes */${stats.size}` },
          });
        }
        const { start, end } = requested ?? { start: 0, end: stats.size - 1 };
        let position = start;
        const pull = Effect.fn("FileResponse.read")(function* (
          controller: ReadableStreamDefaultController<Uint8Array>,
        ) {
          const chunk = new Uint8Array(CHUNK_BYTES);
          const length = Math.min(CHUNK_BYTES, end + 1 - position);
          const { bytesRead } = yield* remoteCall(() => file.read(chunk, 0, length, position));
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
            ...rangeHeaders,
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
