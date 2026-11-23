import type { AgentModelOption, ProviderModelSource } from "@openbot/contracts/ipc";
import { isAgentModel, isReasoningEffort } from "@openbot/contracts/ipc";
import { createOpenBotLogger, registerPublicValues } from "@openbot/logging";
import { Effect, Result } from "effect";
import type { AgentClient, AgentProvider } from "./../agent-client";
import { providerCheckTimeoutMs } from "../disk-restore";
import { decodeModelListResponse, type ModelListResponse } from "./../protocol";
import { providerFailure } from "../provider-client-effects";
import { BUILT_IN_PROVIDER_DRIVERS, type BuiltInProviderDriver } from "./../provider-drivers";
import {
  compareModelVersions,
  FALLBACK_MODELS,
  modelDisplayName,
  OPENCODE_FREE_MODEL_FALLBACKS,
  PREFERRED_MODEL_ORDER,
} from "./provider-models";
import { isProviderTimeout } from "./provider-status";
import { providerLabel } from "./thread-items";

type ProviderModelCatalog = NonNullable<BuiltInProviderDriver["catalog"]>;

const logger = createOpenBotLogger("provider-runtime");
const MODEL_METADATA_FALLBACKS = [...FALLBACK_MODELS, ...OPENCODE_FREE_MODEL_FALLBACKS];

function withPublicIds(models: AgentModelOption[]): AgentModelOption[] {
  registerPublicValues(models.map((model) => model.id));
  return models;
}

export interface ModelCatalogOptions {
  client(provider: AgentProvider): AgentClient | undefined;
  isSignedOut(provider: AgentProvider): boolean;
  requestTimeoutMs: number;
  recordProviderError(provider: AgentProvider, error: unknown): void;
  startSettingsChanged(provider: AgentProvider): Effect.Effect<void>;
}

export class ModelCatalog {
  readonly #options: ModelCatalogOptions;
  #models = withPublicIds(structuredClone(FALLBACK_MODELS));
  readonly #sources = new Map<AgentProvider, ProviderModelSource>();
  readonly #startSettings = new WeakMap<AgentClient, string>();

  constructor(options: ModelCatalogOptions) {
    this.#options = options;
  }

  list(): AgentModelOption[] {
    return structuredClone(this.#models);
  }

  source(provider: AgentProvider): ProviderModelSource | undefined {
    const source = this.#sources.get(provider);
    return source ? structuredClone(source) : undefined;
  }

  readonly #readSource = Effect.fn("ModelCatalog.readSource")(function* (
    this: ModelCatalog,
    provider: AgentProvider,
    client: AgentClient,
    catalog: ProviderModelCatalog,
  ) {
    if (!catalog.source) return false;
    const result = yield* Effect.result(catalog.source(client, providerCheckTimeoutMs(5_000)));
    if (this.#options.client(provider) !== client) return false;
    if (Result.isFailure(result)) logger.warn("A provider did not give the source of its models.", { provider });
    const source = Result.isSuccess(result) ? result.success.source : null;
    const startSettings = Result.isSuccess(result) ? result.success.startSettings : null;
    if (startSettings !== null) {
      const atStart = this.#startSettings.get(client);
      this.#startSettings.set(client, startSettings);
      if (atStart !== undefined && atStart !== startSettings) {
        logger.info("A provider's model settings changed while it ran.", { provider });
        yield* this.#options.startSettingsChanged(provider);
      }
    }
    const before = JSON.stringify(this.#sources.get(provider) ?? null);
    if (source) this.#sources.set(provider, source);
    else this.#sources.delete(provider);
    return JSON.stringify(source) !== before;
  });

  readonly read = Effect.fn("ModelCatalog.read")(function* (
    this: ModelCatalog,
    client: AgentClient,
    catalog: ProviderModelCatalog = {},
    timeoutMs?: number,
  ) {
    const serverModels = new Map<string, ModelListResponse["data"][number]>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const response = yield* client.request(
        "model/list",
        { limit: 100, includeHidden: true, ...(cursor ? { cursor } : {}) },
        decodeModelListResponse,
        providerCheckTimeoutMs(timeoutMs ?? (catalog.slowList ? this.#options.requestTimeoutMs : 5_000)),
      );
      for (const item of response.data) {
        const id = item.model?.trim();
        if (!id) continue;
        if (!isAgentModel(id)) {
          logger.warn("A provider reported a model id that is not valid.", { provider: client.provider, id });
          continue;
        }
        serverModels.set(id, { ...item, model: id, ...(response.steersTurns ? { steersTurns: true } : {}) });
      }
      cursor = catalog.paged ? response.nextCursor : undefined;
      if (cursor && cursors.has(cursor))
        return yield* providerFailure(new Error("Model discovery repeated a pagination cursor."));
      if (cursor) cursors.add(cursor);
    } while (cursor);
    const models: AgentModelOption[] = [];
    for (const server of serverModels.values()) {
      if (!server.model) continue;
      const fallback = MODEL_METADATA_FALLBACKS.find(
        (candidate) => candidate.provider === client.provider && candidate.id === server.model,
      );
      const efforts = (server?.supportedReasoningEfforts ?? [])
        .map((item) => item.reasoningEffort)
        .filter(isReasoningEffort);
      const name = modelDisplayName(
        catalog.modelName?.(server.model) || server.displayName?.trim() || fallback?.name || server.model,
      );
      models.push({
        provider: client.provider,
        id: server.model,
        name,
        description: fallback?.description ?? `${providerLabel(client.provider)} model discovered from the local CLI.`,
        defaultReasoningEffort: isReasoningEffort(server?.defaultReasoningEffort)
          ? server.defaultReasoningEffort
          : (fallback?.defaultReasoningEffort ?? "medium"),
        supportedReasoningEfforts: efforts.length ? efforts : (fallback?.supportedReasoningEfforts ?? ["medium"]),
        ...(server.reasoningEffortConfigurable === false ? { reasoningEffortConfigurable: false } : {}),
        ...catalog.modelFields?.(server),
      });
    }
    const rank = PREFERRED_MODEL_ORDER.get(client.provider) ?? (() => 0);
    const sorted = catalog.ownOrder
      ? models
      : [...models].sort((left, right) => rank(left) - rank(right) || compareModelVersions(left, right));
    return { models: withPublicIds(sorted), listed: serverModels.size };
  });

  readonly refresh = Effect.fn("ModelCatalog.refresh")(function* (this: ModelCatalog) {
    const timeouts = new Map<AgentProvider, unknown>();
    const discovered = yield* Effect.forEach(
      BUILT_IN_PROVIDER_DRIVERS,
      ({ id: provider, catalog = {} }) =>
        Effect.gen({ self: this }, function* () {
          const previous = this.#models.filter((model) => model.provider === provider);
          const client = this.#options.client(provider);
          const signedOut = this.#options.isSignedOut(provider);
          if (catalog.hiddenWhenSignedOut && signedOut && !client)
            return { provider, models: [], fresh: false, timedOut: false, failed: false };
          if (!client) return { provider, models: previous, fresh: false, timedOut: false, failed: false };
          const startedAt = performance.now();
          return yield* Effect.gen({ self: this }, function* () {
            const [{ models: sorted, listed }, sourceChanged] = yield* Effect.all(
              [this.read(client, catalog), this.#readSource(provider, client, catalog)],
              { concurrency: "unbounded" },
            );
            logger.info("A provider listed its models.", {
              provider,
              count: sorted.length,
              durationMs: Math.round(performance.now() - startedAt),
            });
            if (catalog.fallback && listed === 0) {
              return {
                provider,
                models: catalog.fallback(previous),
                fresh: false,
                timedOut: false,
                failed: false,
                sourceChanged,
              };
            }
            return { provider, models: sorted, fresh: true, timedOut: false, failed: false, sourceChanged };
          }).pipe(
            Effect.catch((failure) => {
              const timeout = isProviderTimeout(failure.cause);
              const timedOut = timeout && !catalog.slowList;
              if (timedOut) timeouts.set(provider, failure.cause);
              else this.#options.recordProviderError(provider, failure.cause);
              logger.warn("A provider did not list its models.", {
                provider,
                durationMs: Math.round(performance.now() - startedAt),
                timeout,
              });
              return Effect.succeed({
                provider,
                models: catalog.fallback?.(previous) ?? previous,
                fresh: false,
                timedOut,
                failed: !timeout,
              });
            }),
          );
        }),
      { concurrency: "unbounded" },
    );
    this.#models = withPublicIds(discovered.flatMap((entry) => entry.models));
    return {
      fresh: new Set(discovered.filter((entry) => entry.fresh).map((entry) => entry.provider)),
      timedOut: timeouts,
      failed: new Set(discovered.filter((entry) => entry.failed).map((entry) => entry.provider)),
      sourceChanged: discovered.some((entry) => "sourceChanged" in entry && entry.sourceChanged),
    };
  });

  readonly relist = Effect.fn("ModelCatalog.relist")(function* (
    this: ModelCatalog,
    provider: AgentProvider,
    options: { quiet?: boolean; onQuietFailure?: () => void } = {},
  ) {
    const client = this.#options.client(provider);
    const catalog = BUILT_IN_PROVIDER_DRIVERS.find((driver) => driver.id === provider)?.catalog ?? {};
    if (!client) return false;
    const startedAt = performance.now();
    const result = yield* Effect.result(this.read(client, catalog, this.#options.requestTimeoutMs));
    if (this.#options.client(provider) !== client) return false;
    const durationMs = Math.round(performance.now() - startedAt);
    if (Result.isFailure(result)) {
      if (!options.quiet) this.#options.recordProviderError(provider, result.failure.cause);
      else options.onQuietFailure?.();
      logger.warn("A provider did not list its models.", {
        provider,
        durationMs,
        timeout: isProviderTimeout(result.failure.cause),
      });
      return false;
    }
    const { models, listed } = result.success;
    logger.info("A provider listed its models.", { provider, count: models.length, durationMs });
    if ((catalog.fallback || options.quiet) && listed === 0) return false;
    yield* this.#readSource(provider, client, catalog);
    if (this.#options.client(provider) !== client) return false;
    const current = this.#models;
    this.#models = withPublicIds(
      BUILT_IN_PROVIDER_DRIVERS.flatMap(({ id }) =>
        id === provider ? models : current.filter((model) => model.provider === id),
      ),
    );
    return true;
  });
}
