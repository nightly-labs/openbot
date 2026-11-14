import { createWriteStream } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { downloadMediaMessage, type WAMessage } from "@openbot/whatsapp/baileys";
import type { WhatsAppSession } from "./whatsapp-session";

/**
 * Writes the file of a message to `destination`, readable only by this user. Stops with
 * `file_too_large` after `maxBytes`; the caller deletes what it wrote. WhatsApp sends a new link for
 * an old file when the socket is open.
 */
export async function downloadWhatsAppMedia(
  session: WhatsAppSession,
  message: WAMessage,
  destination: string,
  maxBytes: number,
): Promise<void> {
  const socket = session.socket();
  const stream = await downloadMediaMessage(
    message,
    "stream",
    {},
    {
      logger: silentLogger,
      reuploadRequest: (stale) =>
        socket ? socket.updateMediaMessage(stale) : Promise.reject(new Error("not_connected")),
    },
  );
  let total = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      total += chunk.byteLength;
      done(total > maxBytes ? new Error("file_too_large") : null, chunk);
    },
  });
  await pipeline(stream, limit, createWriteStream(destination, { mode: 0o600 }));
}

const silentLogger = {
  level: "silent",
  child: () => silentLogger,
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
