import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";

export const JSON_BODY_LIMIT = 16 * 1024;

export class JsonBodyError extends Error {
  constructor(
    readonly status: 400 | 413,
    readonly code: "invalid_json" | "request_too_large",
    message: string,
  ) {
    super(message);
  }
}

export const readJsonObject = Effect.fn("JsonBody.readJsonObject")(function* (request: Request) {
  const bytes = yield* readRequestBytes(request, JSON_BODY_LIMIT);
  const value = yield* Effect.try({ try: () => JSON.parse(new TextDecoder().decode(bytes)), catch: invalidJson });
  if (!isDynamicRecord(value)) return yield* Effect.fail(invalidJson());
  return value;
});

export const readMultipartFormData = Effect.fn("JsonBody.readMultipartFormData")(function* (
  request: Request,
  limit: number,
) {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) return yield* Effect.fail(invalidJson());
  const bytes = yield* readRequestBytes(request, limit);
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  return yield* Effect.tryPromise({
    try: () => new Response(body.buffer, { headers: { "Content-Type": contentType } }).formData(),
    catch: invalidJson,
  });
});

export const readRequestBytes = Effect.fn("JsonBody.readRequestBytes")(function* (request: Request, limit: number) {
  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > limit) {
      return yield* Effect.fail(tooLarge());
    }
  }

  const reader = request.body?.getReader();
  if (!reader) return yield* Effect.fail(invalidJson());
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = yield* Effect.promise(() => reader.read());
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      yield* Effect.tryPromise(() => reader.cancel()).pipe(Effect.ignore);
      return yield* Effect.fail(tooLarge());
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
});

function invalidJson(): JsonBodyError {
  return new JsonBodyError(400, "invalid_json", "The request body is invalid.");
}

function tooLarge(): JsonBodyError {
  return new JsonBodyError(413, "request_too_large", "The request body is too large.");
}
