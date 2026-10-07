// One `GET {baseUrl}/models` request to an OpenAI-compatible server, made in main because the
// renderer's content security policy blocks a local address and a stored key must not go back to
// the page.
//
// An error names the host only. The path and the query of a base URL can hold a token, and the key
// and the header values are credentials, so no message and no log line contains them.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { CustomProviderHeader, DetectedModel } from "@openbot/contracts/ipc";
import { PROVIDER_DETECTION_LIMITS } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Context, Effect, Layer, Schema } from "effect";

/** A model list is a small JSON object. A larger body is not a model list. */
export const MODEL_LIST_BODY_LIMIT = 1024 * 1024;

interface ModelServerTarget {
  baseUrl: string;
  apiKey: string | null;
  headers: readonly CustomProviderHeader[];
}

/** The part of an address that an error may name. */
function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return "?";
  }
}

function modelsUrl(baseUrl: string): URL {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/models`;
  return url;
}

class ModelServerUnavailable extends Schema.TaggedError<ModelServerUnavailable>()("ModelServerUnavailable", {
  message: Schema.String,
}) {}

class ModelServerTimeout extends Schema.TaggedError<ModelServerTimeout>()("ModelServerTimeout", {
  message: Schema.String,
}) {}

class ModelServerRejected extends Schema.TaggedError<ModelServerRejected>()("ModelServerRejected", {
  message: Schema.String,
}) {}

class InvalidModelList extends Schema.TaggedError<InvalidModelList>()("InvalidModelList", {
  message: Schema.String,
}) {}

class ModelListTooLarge extends Schema.TaggedError<ModelListTooLarge>()("ModelListTooLarge", {
  message: Schema.String,
}) {}

export type ProbeError =
  | ModelServerUnavailable
  | ModelServerTimeout
  | ModelServerRejected
  | InvalidModelList
  | ModelListTooLarge;

// The envelope is strict; individual entries remain tolerant for server compatibility.
const ModelListEnvelope = Schema.Struct({ data: Schema.Array(Schema.Unknown) });

/** Secret-bearing request details and causes never enter errors or tracing attributes. */
export const probeModels = Effect.fn("ModelServerProbe.probe")(function* (
  target: ModelServerTarget,
  timeoutMs: number,
): Effect.fn.Return<DetectedModel[], ProbeError> {
  const host = hostOf(target.baseUrl);
  const url = yield* Effect.try({
    try: () => modelsUrl(target.baseUrl),
    catch: () => new ModelServerRejected({ message: sourceText("error.provider.baseUrlInvalid") }),
  });
  const headers = new Headers({ Accept: "application/json" });
  for (const header of target.headers) headers.set(header.name, header.value);
  if (target.apiKey) headers.set("Authorization", `Bearer ${target.apiKey}`);
  const unavailable = () =>
    new ModelServerUnavailable({ message: sourceText("error.provider.discoveryUnreachable", { host }) });
  return yield* Effect.acquireUseRelease(
    Effect.sync(() => new AbortController()),
    (controller) =>
      Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
          try: () => fetch(url, { method: "GET", headers, redirect: "manual", signal: controller.signal }),
          catch: unavailable,
        });
        if (response.status >= 300 && response.status < 400) {
          return yield* new ModelServerRejected({ message: sourceText("error.provider.discoveryRedirect", { host }) });
        }
        if (response.status === 401 || response.status === 403) {
          return yield* new ModelServerRejected({ message: sourceText("error.provider.discoveryRefused", { host }) });
        }
        if (!response.ok) {
          return yield* new ModelServerRejected({
            message: sourceText("error.provider.discoveryHttp", { host, status: String(response.status) }),
          });
        }
        const text = yield* readLimited(response, host);
        const parsed = yield* Effect.try({
          try: (): unknown => JSON.parse(text),
          catch: () => new InvalidModelList({ message: sourceText("error.provider.discoveryInvalid", { host }) }),
        });
        const envelope = yield* Schema.decodeUnknownEffect(ModelListEnvelope)(parsed).pipe(
          Effect.mapError(
            () => new InvalidModelList({ message: sourceText("error.provider.discoveryInvalid", { host }) }),
          ),
        );
        return parseModelList(envelope.data);
      }).pipe(
        Effect.timeoutOrElse({
          duration: timeoutMs,
          orElse: () =>
            Effect.fail(new ModelServerTimeout({ message: sourceText("error.provider.discoveryTimeout", { host }) })),
        }),
      ),
    (controller) => Effect.sync(() => controller.abort()),
  );
});

export class ModelServerProbe extends Context.Service<
  ModelServerProbe,
  {
    probe(target: ModelServerTarget, timeoutMs: number): Effect.Effect<DetectedModel[], ProbeError>;
  }
>()("openbot/main/ModelServerProbe") {
  static readonly layer = Layer.succeed(ModelServerProbe, { probe: probeModels });
}

const readLimited = Effect.fn("ModelServerProbe.readLimited")(function* (response: Response, host: string) {
  const tooLarge = () => new ModelListTooLarge({ message: sourceText("error.provider.discoveryTooLarge", { host }) });
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MODEL_LIST_BODY_LIMIT) return yield* tooLarge();
  const reader = response.body?.getReader();
  if (!reader) return "";
  return yield* Effect.acquireUseRelease(
    Effect.succeed(reader),
    (body) =>
      Effect.gen(function* () {
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (;;) {
          const chunk = yield* Effect.tryPromise({
            try: () => body.read(),
            catch: () =>
              new ModelServerUnavailable({ message: sourceText("error.provider.discoveryUnreachable", { host }) }),
          });
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > MODEL_LIST_BODY_LIMIT) return yield* tooLarge();
          chunks.push(chunk.value);
        }
        return Buffer.concat(chunks).toString("utf8");
      }),
    // Cancel and release the body on success, failure, and interruption. Cleanup cannot expose a URL.
    (body) =>
      Effect.promise(() => body.cancel().catch(() => undefined)).pipe(
        Effect.ensuring(Effect.sync(() => body.releaseLock())),
      ),
  );
});

/** Skip unusable entries, deduplicate ids, and stop at the public limit. */
function parseModelList(entries: readonly unknown[]): DetectedModel[] {
  const seen = new Set<string>();
  const models: DetectedModel[] = [];
  for (const entry of entries) {
    if (models.length >= PROVIDER_DETECTION_LIMITS.models) break;
    if (!isDynamicRecord(entry) || !isString(entry.id)) continue;
    const id = entry.id.trim();
    if (!id || id.length > INPUT_LIMITS.identifier || seen.has(id)) continue;
    seen.add(id);
    models.push({ id });
  }
  return models;
}
