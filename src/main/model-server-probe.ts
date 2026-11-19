// One `GET {baseUrl}/models` request to an OpenAI-compatible server, made in main because the
// renderer's content security policy blocks a local address and a stored key must not go back to
// the page.
//
// An error names the host only. The path and the query of a base URL can hold a token, and the key
// and the header values are credentials, so no message and no log line contains them.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { CustomProviderHeader, CustomProviderInputKind, DetectedModel } from "@openbot/contracts/ipc";
import {
  CUSTOM_PROVIDER_INPUT_KINDS,
  CUSTOM_PROVIDER_REASONING_EFFORTS,
  isCustomProviderContextWindow,
  isCustomProviderMaxOutput,
  PROVIDER_DETECTION_LIMITS,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Context, Effect, Layer, Schema } from "effect";
import { readLimitedBody } from "../backend/limited-body";

/** A model list is a small JSON object. A larger body is not a model list. */
const MODEL_LIST_BODY_LIMIT = 1024 * 1024;

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
        return yield* withLmStudioContext(parseModelList(envelope.data), target.baseUrl, headers, controller.signal);
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
  const body = yield* readLimitedBody(response, MODEL_LIST_BODY_LIMIT, (reason) =>
    reason === "too-large"
      ? new ModelListTooLarge({ message: sourceText("error.provider.discoveryTooLarge", { host }) })
      : new ModelServerUnavailable({ message: sourceText("error.provider.discoveryUnreachable", { host }) }),
  );
  return body.toString("utf8");
});

/**
 * LM Studio's native model list, beside its OpenAI-compatible `/v1`: `http://host:1234/v1` gives
 * `http://host:1234/api/v0/models`. Null for a base URL that does not end in `/v1`.
 */
function lmStudioModelsUrl(baseUrl: string): URL | null {
  const url = URL.parse(baseUrl);
  if (!url) return null;
  const path = url.pathname.replace(/\/+$/, "");
  if (!path.endsWith("/v1")) return null;
  url.pathname = `${path.slice(0, -"/v1".length)}/api/v0/models`;
  return url;
}

/**
 * The context window that an LM Studio `/api/v0/models` entry gives: the length the model is loaded
 * with, or else the most it can be loaded with. A loaded model answers only within its loaded
 * length, which can be far below its maximum.
 */
function lmStudioContextWindow(entry: unknown): number | undefined {
  if (!isDynamicRecord(entry)) return undefined;
  const loaded = entry.state === "loaded" ? entry.loaded_context_length : undefined;
  return [loaded, entry.max_context_length].find(isCustomProviderContextWindow);
}

/** Fills in the context windows of models that came without one from LM Studio's native list. */
function mergeLmStudioContext(models: readonly DetectedModel[], entries: readonly unknown[]): DetectedModel[] {
  const windows = new Map<string, number>();
  for (const entry of entries) {
    if (!isDynamicRecord(entry) || !isString(entry.id)) continue;
    const contextWindow = lmStudioContextWindow(entry);
    if (contextWindow !== undefined) windows.set(entry.id.trim(), contextWindow);
  }
  return models.map((model) => {
    const contextWindow = model.contextWindow ?? windows.get(model.id);
    return contextWindow === undefined ? model : { ...model, contextWindow };
  });
}

/**
 * LM Studio, and apps built on it such as Bionic, list no limits on `/v1/models`. Without a context
 * window, a saved model gets the runtime's default token limits, which are far below what a local
 * model is loaded with. Their native `/api/v0/models` names the context length, so a list in which
 * no model has a window asks it once. A server that gives windows is not LM Studio. This is best
 * effort: any failure keeps the list as it is.
 */
const withLmStudioContext = (
  models: DetectedModel[],
  baseUrl: string,
  headers: Headers,
  signal: AbortSignal,
): Effect.Effect<DetectedModel[]> => {
  const url = lmStudioModelsUrl(baseUrl);
  if (!url || models.length === 0 || models.some((model) => model.contextWindow !== undefined)) {
    return Effect.succeed(models);
  }
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise(() => fetch(url, { method: "GET", headers, redirect: "manual", signal }));
    if (!response.ok) return models;
    const body = yield* readLimitedBody(response, MODEL_LIST_BODY_LIMIT, () => "unreadable" as const);
    const parsed = yield* Effect.try((): unknown => JSON.parse(body.toString("utf8")));
    if (!isDynamicRecord(parsed) || !Array.isArray(parsed.data)) return models;
    return mergeLmStudioContext(models, parsed.data);
  }).pipe(Effect.orElseSucceed(() => models));
};

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
    models.push({ id, ...modelDetails(entry) });
  }
  return models;
}

/** The input kinds of a list, by their names there. OpenRouter calls a PDF input `file`. */
const LISTED_INPUT_KINDS: ReadonlyMap<string, CustomProviderInputKind> = new Map([
  ["image", "image"],
  ["pdf", "pdf"],
  ["file", "pdf"],
]);

/**
 * What a list entry says about the model, in the shapes that servers publish: models.dev
 * (`modalities.input`, `limit.context`, `limit.output`), OpenRouter (`architecture.input_modalities`,
 * `context_length`, `top_provider.max_completion_tokens`, `reasoning.supported_efforts`), RefuseLess
 * (`reasoning_efforts`) and vLLM (`max_model_len`). A missing or out-of-range value is left out, and
 * so is an effort that a custom model cannot declare, such as RefuseLess's `off` (#5784).
 */
function modelDetails(entry: DynamicRecord): Omit<DetectedModel, "id"> {
  const limit = isDynamicRecord(entry.limit) ? entry.limit : {};
  const topProvider = isDynamicRecord(entry.top_provider) ? entry.top_provider : {};
  const contextWindow = [limit.context, entry.context_length, entry.max_model_len].find(isCustomProviderContextWindow);
  const maxOutput = [limit.output, topProvider.max_completion_tokens].find(isCustomProviderMaxOutput);
  const listed = [
    isDynamicRecord(entry.modalities) ? entry.modalities.input : undefined,
    isDynamicRecord(entry.architecture) ? entry.architecture.input_modalities : undefined,
  ].find(Array.isArray);
  const inputs = Array.isArray(listed)
    ? CUSTOM_PROVIDER_INPUT_KINDS.filter((kind) =>
        listed.some((name) => isString(name) && LISTED_INPUT_KINDS.get(name) === kind),
      )
    : undefined;
  const reasoning = isDynamicRecord(entry.reasoning) ? entry.reasoning : {};
  const listedEfforts = [reasoning.supported_efforts, entry.reasoning_efforts].find(Array.isArray);
  const reasoningEfforts = Array.isArray(listedEfforts)
    ? CUSTOM_PROVIDER_REASONING_EFFORTS.filter((effort) => listedEfforts.includes(effort))
    : [];
  return {
    ...(inputs ? { inputs } : {}),
    ...(reasoningEfforts.length > 0 ? { reasoningEfforts } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    // The form takes a max output only with a context window. A cap as large as the window leaves no
    // room for the prompt (OpenRouter often lists both as the same number), so the default stays.
    ...(contextWindow !== undefined && maxOutput !== undefined && maxOutput < contextWindow ? { maxOutput } : {}),
  };
}
