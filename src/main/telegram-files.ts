import { open, readFile, rm } from "node:fs/promises";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import {
  TELEGRAM_FILE_BYTES_LIMIT,
  TELEGRAM_FILES_PATH,
  TELEGRAM_UPLOADS_PATH,
} from "@openbot/contracts/signal-protocol/telegram-route";
import { Effect } from "effect";
import { MessagingAdapterError, TelegramCallError } from "../backend/messaging/messaging-types";

const REQUEST_TIMEOUT_MS = 60_000;

function filesIo<A>(run: (signal: AbortSignal) => Promise<A>): Effect.Effect<A, MessagingAdapterError> {
  return Effect.tryPromise({
    try: (signal) => run(AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])),
    catch: (cause) => new MessagingAdapterError({ cause }),
  });
}

function failure(errorCode: number, description: string): MessagingAdapterError {
  return new MessagingAdapterError({ cause: new TelegramCallError(errorCode, description, null) });
}

export function signalHttpOrigin(signalUrl: string): string {
  const url = new URL(signalUrl);
  url.protocol = url.protocol === "ws:" ? "http:" : "https:";
  return url.origin;
}

export const downloadTelegramFile = Effect.fnUntraced(function* (
  origin: string,
  fileToken: string,
  destination: string,
  maxBytes: number,
) {
  const limit = Math.min(maxBytes, TELEGRAM_FILE_BYTES_LIMIT);
  const response = yield* filesIo((signal) =>
    fetch(`${origin}${TELEGRAM_FILES_PATH}/${encodeURIComponent(fileToken)}`, { signal, redirect: "error" }),
  );
  if (!response.ok || !response.body) {
    yield* filesIo(async () => response.body?.cancel()).pipe(Effect.catch(() => Effect.void));
    return yield* failure(response.status, "file_unavailable");
  }
  if (Number(response.headers.get("content-length") ?? "0") > limit) {
    yield* filesIo(async () => response.body?.cancel()).pipe(Effect.catch(() => Effect.void));
    return yield* failure(413, "file_too_large");
  }
  const reader = response.body.getReader();
  yield* Effect.acquireUseRelease(
    filesIo(() => open(destination, "w", 0o600)),
    (file) =>
      Effect.gen(function* () {
        let received = 0;
        for (;;) {
          const { done, value } = yield* filesIo(() => reader.read());
          if (done) return;
          received += value.byteLength;
          if (received > limit) return yield* failure(413, "file_too_large");
          yield* filesIo(() => file.write(value));
        }
      }),
    (file) => Effect.promise(() => file.close()),
  ).pipe(
    Effect.onError(() => filesIo(() => rm(destination, { force: true })).pipe(Effect.orDie)),
    Effect.ensuring(filesIo(() => reader.cancel()).pipe(Effect.catch(() => Effect.void))),
  );
});

export const uploadTelegramFile = Effect.fnUntraced(function* (origin: string, uploadToken: string, path: string) {
  const bytes = yield* filesIo(() => readFile(path));
  if (bytes.byteLength === 0 || bytes.byteLength > TELEGRAM_FILE_BYTES_LIMIT)
    return yield* failure(413, "file_too_large");
  const response = yield* filesIo((signal) =>
    fetch(`${origin}${TELEGRAM_UPLOADS_PATH}/${encodeURIComponent(uploadToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array(bytes),
      signal,
      redirect: "error",
    }),
  );
  const answer = yield* filesIo(() => response.json()).pipe(Effect.catch(() => Effect.succeed(null)));
  if (!isDynamicRecord(answer)) return yield* failure(response.status, "upload_failed");
  if (answer.ok === true && isNumber(answer.messageId)) return answer.messageId;
  return yield* new MessagingAdapterError({
    cause: new TelegramCallError(
      isNumber(answer.errorCode) ? answer.errorCode : response.status,
      isString(answer.description) ? answer.description.slice(0, 256) : "upload_failed",
      isNumber(answer.retryAfter) ? answer.retryAfter : null,
    ),
  });
});
