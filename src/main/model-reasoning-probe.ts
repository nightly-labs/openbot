// Which models of an Ollama server cannot reason (#8381).
//
// Ollama refuses a `reasoning_effort` for a model without its `thinking` capability, and OpenCode
// sends the agent's effort to each custom model that has no saved efforts. The model list at
// `/v1/models` does not have the capability; Ollama's own `POST /api/show` has it. This module asks
// in main, as `model-server-probe.ts` does, and for the same reason: the key stays here.
//
// Nothing is saved. A server that is not Ollama, or that does not answer, gives no answer, and its
// models keep the efforts of their harness. No error and no log line names the address or the key.

import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { Effect, Schema } from "effect";
import { readLimitedBody } from "../backend/limited-body";
import type { CustomProviderConfig } from "../backend/opencode-config";

/** An answer of `/api/show` holds the model's template and license text. */
const SHOW_BODY_LIMIT = 4 * 1024 * 1024;

/** A local server answers in milliseconds. A save waits for this probe, so the limit is short. */
const REASONING_PROBE_TIMEOUT_MS = 3_000;

const SHOW_CONCURRENCY = 4;

/**
 * The waits before each question at start: at once, then again while a server does not answer. A
 * server that starts at login is up in this time. After it, the next endpoint save asks again.
 */
export const MODEL_REASONING_RETRY_WAITS_MS = [0, 5_000, 20_000, 60_000] as const;

/** `unreachable`: the server did not answer at all, so a later request can get an answer. */
class ReasoningUnknown extends Schema.TaggedError<ReasoningUnknown>()("ReasoningUnknown", {
  unreachable: Schema.Boolean,
}) {}

const UNREACHABLE = "unreachable" as const;

/** The address above `/v1`, where Ollama serves its own API. Null: not an address of that shape. */
function ollamaRoot(baseUrl: string): string | null {
  const url = URL.parse(baseUrl);
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) return null;
  const path = url.pathname.replace(/\/+$/, "");
  return path.endsWith("/v1") ? `${url.origin}${path.slice(0, -"/v1".length)}` : null;
}

const readJson = Effect.fn("ModelReasoningProbe.readJson")(function* (
  url: string,
  headers: Headers,
  body: string | null,
): Effect.fn.Return<DynamicRecord, ReasoningUnknown> {
  const response = yield* Effect.tryPromise({
    try: (signal) => fetch(url, { method: body === null ? "GET" : "POST", headers, body, redirect: "manual", signal }),
    catch: () => new ReasoningUnknown({ unreachable: true }),
  });
  const refused = () => new ReasoningUnknown({ unreachable: false });
  if (!response.ok) {
    yield* Effect.promise(() => response.body?.cancel().catch(() => undefined) ?? Promise.resolve());
    return yield* refused();
  }
  const text = yield* readLimitedBody(response, SHOW_BODY_LIMIT, refused);
  const value = yield* Effect.try({ try: (): unknown => JSON.parse(text.toString("utf8")), catch: refused });
  return isDynamicRecord(value) ? value : yield* refused();
});

export type ReasoningProbe = (
  target: Pick<CustomProviderConfig, "baseUrl" | "apiKey" | "headers">,
  models: readonly string[],
) => Effect.Effect<readonly string[] | null | typeof UNREACHABLE>;

/**
 * The ids of `models` that the server reports without the `thinking` capability. Null: the server
 * is not Ollama. `unreachable`: it did not answer, for example because it starts after OpenBot. A
 * model that the server does not describe is left out.
 */
const probeModelsWithoutReasoning: ReasoningProbe = Effect.fn("ModelReasoningProbe.probe")(function* (target, models) {
  const root = ollamaRoot(target.baseUrl);
  if (root === null) return null;
  const headers = new Headers({ Accept: "application/json", "Content-Type": "application/json" });
  for (const header of target.headers) headers.set(header.name, header.value);
  if (target.apiKey) headers.set("Authorization", `Bearer ${target.apiKey}`);
  return yield* Effect.gen(function* () {
    // Only Ollama answers here with its version. Each other server gets this one request.
    const version = yield* readJson(`${root}/api/version`, headers, null);
    if (!isString(version.version)) return null;
    const found = yield* Effect.forEach(
      models,
      (model) =>
        readJson(`${root}/api/show`, headers, JSON.stringify({ model })).pipe(
          Effect.map((shown) =>
            Array.isArray(shown.capabilities) && !shown.capabilities.includes("thinking") ? [model] : [],
          ),
          Effect.catch(() => Effect.succeed<string[]>([])),
        ),
      { concurrency: SHOW_CONCURRENCY },
    );
    return found.flat();
  }).pipe(
    Effect.catch((unknown) => Effect.succeed(unknown.unreachable ? UNREACHABLE : null)),
    Effect.timeoutOrElse({ duration: REASONING_PROBE_TIMEOUT_MS, orElse: () => Effect.succeed(UNREACHABLE) }),
  );
});

export interface ModelReasoningSupport {
  /** The endpoints for a provider spawn, each with the models that its server reports as not able to reason. */
  configs(): readonly CustomProviderConfig[];
  /**
   * Asks the servers again. `changed`: the answer changed, so a running OpenCode has an old config.
   * `unreachable`: a server did not answer, so a later refresh can change the answer.
   */
  refresh(): Effect.Effect<{ changed: boolean; unreachable: boolean }>;
}

/**
 * Holds the last answer of each endpoint, by id and address. Only the models that OpenCode runs and
 * that have no saved efforts are asked about: saved efforts are the user's decision, and Pi offers
 * no effort to such a model. An endpoint that gives no answer keeps its last one.
 */
export function createModelReasoningSupport(
  source: () => readonly CustomProviderConfig[],
  probe: ReasoningProbe = probeModelsWithoutReasoning,
): ModelReasoningSupport {
  let known = new Map<string, readonly string[]>();
  let latest = 0;
  const key = (provider: CustomProviderConfig) => `${provider.id}\n${provider.baseUrl}`;
  return {
    configs: () =>
      source().map((provider) => {
        const withoutReasoning = known.get(key(provider));
        return withoutReasoning?.length ? { ...provider, withoutReasoning } : provider;
      }),
    refresh: Effect.fn("ModelReasoningSupport.refresh")(function* () {
      latest += 1;
      const run = latest;
      let unreachable = false;
      const answers = yield* Effect.forEach(
        source().filter((provider) => (provider.harness ?? "opencode") === "opencode"),
        (provider) => {
          const models = provider.models.filter((model) => model.reasoningEfforts === undefined).map(({ id }) => id);
          const answer = models.length > 0 ? probe(provider, models) : Effect.succeed<readonly string[]>([]);
          return answer.pipe(
            Effect.map((ids) => {
              if (ids === UNREACHABLE) unreachable = true;
              return [key(provider), Array.isArray(ids) ? ids : (known.get(key(provider)) ?? [])] as const;
            }),
          );
        },
        { concurrency: "unbounded" },
      );
      // A later refresh has the newer endpoints. Its answer stays.
      if (run !== latest) return { changed: false, unreachable: false };
      const next = new Map(answers.filter(([, ids]) => ids.length > 0));
      const changed = JSON.stringify([...next].sort()) !== JSON.stringify([...known].sort());
      known = next;
      return { changed, unreachable };
    }),
  };
}
