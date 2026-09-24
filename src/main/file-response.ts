import { open } from "node:fs/promises";

const CHUNK_BYTES = 64 * 1_024;

/**
 * A protocol response that streams a file from disk. A response built from `readFile` held each whole
 * file in the main process until the next garbage collection: a chat with 20 large images kept about
 * 360 MB there while it loaded. Rejects when the file cannot be opened, so the caller still answers 404.
 */
export async function fileResponse(path: string, headers: Record<string, string>): Promise<Response> {
  const file = await open(path, "r");
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = new Uint8Array(CHUNK_BYTES);
        const { bytesRead } = await file.read(chunk, 0, CHUNK_BYTES, null);
        if (bytesRead === 0) {
          controller.close();
          await file.close();
          return;
        }
        controller.enqueue(chunk.subarray(0, bytesRead));
      } catch (error) {
        controller.error(error);
        await file.close().catch(() => undefined);
      }
    },
    cancel: () => file.close(),
  });
  return new Response(body, { headers });
}
