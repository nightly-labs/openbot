import { createWriteStream } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { downloadMediaMessage, type WAMessage } from "@openbot/whatsapp/baileys";
import type { WhatsAppSession } from "./whatsapp-session";

export async function downloadWhatsAppMedia(
  session: WhatsAppSession,
  message: WAMessage,
  destination: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<void> {
  const socket = session.socket();
  const stream = await downloadMediaMessage(message, "stream", signal ? { options: { signal } } : {}, {
    logger: silentLogger,
    reuploadRequest: (stale) =>
      socket ? socket.updateMediaMessage(stale) : Promise.reject(new Error("not_connected")),
  });
  let total = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      total += chunk.byteLength;
      done(total > maxBytes ? new Error("file_too_large") : null, chunk);
    },
  });
  const file = createWriteStream(destination, { mode: 0o600 });
  await (signal ? pipeline(stream, limit, file, { signal }) : pipeline(stream, limit, file));
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
