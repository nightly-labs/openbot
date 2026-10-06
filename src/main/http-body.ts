import type { IncomingMessage } from "node:http";

/** The request body, or null when it is larger than `limit` bytes. Reading stops at the chunk that passes the limit. */
export async function readBodyWithin(request: IncomingMessage, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > limit) return null;
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}
