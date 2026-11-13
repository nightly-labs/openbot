import type { AgentModelOption } from "@openbot/contracts/ipc";
import { isAgentModel, isReasoningEffort } from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";
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

export interface ModelCatalogOptions {
  /** The running client of a provider, if it has one. */
  client(provider: AgentProvider): AgentClient | undefined;
  /** True while the provider's row says that the user must sign in. */
  isSignedOut(provider: AgentProvider): boolean;
  requestTimeoutMs: number;
  /** Keeps a failed model list on the provider row. */
  recordProviderError(provider: AgentProvider, error: unknown): void;
}

/**
 * Owns the model catalogue of every built-in provider and the `model/list` pass that refreshes it.
 * It never imports the provider runtime: the provider errors and the status stay there.
 */
export class ModelCatalog {
  readonly #options: ModelCatalogOptions;
  #models = structuredClone(FALLBACK_MODELS);

  constructor(options: ModelCatalogOptions) {
    this.#options = options;
  }

  list(): AgentModelOption[] {
    return structuredClone(this.#models);
  }

  /**
   * Reads the models that one client serves, in the catalogue's order, and how many the CLI listed.
   * A provider account after the first reads its own list with it. Fails as `model/list` fails.
   * Without `timeoutMs`, the list has 5 s, or the full request timeout for a slow list.
   */
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
        // A slow list answers inside the normal request timeout, and a list that timed out
        // kept that agent out of the catalogue.
        providerCheckTimeoutMs(timeoutMs ?? (catalog.slowList ? this.#options.requestTimeoutMs : 5_000)),
      );
      // Every model the CLI reports is offered, the ones it marks hidden included; only the
      // stored-key drop below keeps a model out. A CLI hides a model it still accepts -- a new release such
      // as `gpt-6-astra` is hidden until its own launch -- and this app has no way to tell
      // that apart from a model the account cannot use, so a hidden flag was the only
      // reason a working model was missing from the picker while the same CLI ran it
      // happily from a terminal.
      for (const item of response.data) {
        // The trimmed id is what is kept: `isAgentModel` allows no whitespace, so a padded
        // id would fail the contract guard downstream and take the whole list with it.
        const id = item.model?.trim();
        if (!id) continue;
        // An id the contract refuses is dropped alone, for the same reason: the Cursor CLI
        // once added `=` and `,`, and that emptied the picker for every provider.
        if (!isAgentModel(id)) {
          logger.warn("A provider reported a model id that is not valid.", { provider: client.provider, id });
          continue;
        }
        serverModels.set(id, { ...item, model: id });
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
      // The name the provider CLI gives, whole: a model is easier to recognise as
      // `GPT-5.6 Sol` than as `Sol`, and its own CLI names it that way.
      // A provider can name its models itself, such as Claude Code.
      // Clamped, because a name over the limit is not a long name downstream: it fails
      // `isAgentModelOption`, and the IPC and Team API list decoders fail closed on the
      // whole array, so one over-long name empties the picker. OpenCode is the CLI that
      // reaches it - it names a custom model `"<provider name>/<model name>"`, and 80 plus
      // 160 characters passes 160 - but the clamp protects every CLI.
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
    // Tier first, then newest first. Sort is stable, so the CLI's own order still decides
    // between models of one version.
    const sorted = catalog.ownOrder
      ? models
      : [...models].sort((left, right) => rank(left) - rank(right) || compareModelVersions(left, right));
    return { models: sorted, listed: serverModels.size };
  });

  /**
   * Reads the catalogue of every connected CLI. Answers which providers replied with a fresh one,
   * which providers' 5 s `model/list` timed out, and which providers' `model/list` failed.
   *
   * A provider that has no client, or whose `model/list` failed or timed out, keeps the models it
   * already had. That is the right catalogue to keep answering with, but it is not proof of what the
   * process now running serves, so its id is absent from the set and no caller may treat it as proof.
   */
  readonly refresh = Effect.fn("ModelCatalog.refresh")(function* (this: ModelCatalog) {
    const discovered = yield* Effect.forEach(
      BUILT_IN_PROVIDER_DRIVERS,
      ({ id: provider, catalog = {} }) =>
        Effect.gen({ self: this }, function* () {
          const previous = this.#models.filter((model) => model.provider === provider);
          const client = this.#options.client(provider);
          const signedOut = this.#options.isSignedOut(provider);
          // Do not expose fallback or stale models when the provider reports sign-in-required. A
          // client in the map has an account: activation refreshes the catalog before it marks the
          // provider available, so the old status alone does not mean signed out.
          if (catalog.hiddenWhenSignedOut && signedOut && !client)
            return { provider, models: [], fresh: false, timedOut: false, failed: false };
          if (!client) return { provider, models: previous, fresh: false, timedOut: false, failed: false };
          const startedAt = performance.now();
          return yield* Effect.gen({ self: this }, function* () {
            const { models: sorted, listed } = yield* this.read(client, catalog);
            // For a provider with a fallback, a successful but empty response is no more useful to
            // the picker than a timeout: it must not erase the built-in free tier on first
            // discovery. It is not a fresh catalog, so callers must not treat it as proof that
            // this process serves it.
            logger.info("A provider listed its models.", {
              provider,
              count: sorted.length,
              durationMs: Math.round(performance.now() - startedAt),
            });
            if (catalog.fallback && listed === 0) {
              return { provider, models: catalog.fallback(previous), fresh: false, timedOut: false, failed: false };
            }
            return { provider, models: sorted, fresh: true, timedOut: false, failed: false };
          }).pipe(
            Effect.catch((failure) => {
              const timeout = isProviderTimeout(failure.cause);
              this.#options.recordProviderError(provider, failure.cause);
              logger.warn("A provider did not list its models.", {
                provider,
                durationMs: Math.round(performance.now() - startedAt),
                timeout,
              });
              return Effect.succeed({
                provider,
                models: catalog.fallback?.(previous) ?? previous,
                fresh: false,
                // A slow list already had the full request timeout, so a second read gains nothing.
                timedOut: timeout && !catalog.slowList,
                // The list that stays can be the list of a CLI that an update replaced (#8321).
                failed: !timeout,
              });
            }),
          );
        }),
      { concurrency: "unbounded" },
    );
    this.#models = discovered.flatMap((entry) => entry.models);
    return {
      fresh: new Set(discovered.filter((entry) => entry.fresh).map((entry) => entry.provider)),
      timedOut: new Set(discovered.filter((entry) => entry.timedOut).map((entry) => entry.provider)),
      failed: new Set(discovered.filter((entry) => entry.failed).map((entry) => entry.provider)),
    };
  });

  /**
   * Reads the list of one provider again, with the full request timeout, and answers whether it is
   * fresh. Only a fresh list replaces the provider's models, so a failed read cannot put an older
   * list back over a fresh one. A client that another one replaced during the read changes nothing:
   * the activation of the new client reads its own list.
   */
  readonly relist = Effect.fn("ModelCatalog.relist")(function* (this: ModelCatalog, provider: AgentProvider) {
    const client = this.#options.client(provider);
    const catalog = BUILT_IN_PROVIDER_DRIVERS.find((driver) => driver.id === provider)?.catalog ?? {};
    if (!client) return false;
    const startedAt = performance.now();
    const result = yield* Effect.result(this.read(client, catalog, this.#options.requestTimeoutMs));
    if (this.#options.client(provider) !== client) return false;
    const durationMs = Math.round(performance.now() - startedAt);
    if (Result.isFailure(result)) {
      this.#options.recordProviderError(provider, result.failure.cause);
      logger.warn("A provider did not list its models.", {
        provider,
        durationMs,
        timeout: isProviderTimeout(result.failure.cause),
      });
      return false;
    }
    const { models, listed } = result.success;
    logger.info("A provider listed its models.", { provider, count: models.length, durationMs });
    if (catalog.fallback && listed === 0) return false;
    const current = this.#models;
    this.#models = BUILT_IN_PROVIDER_DRIVERS.flatMap(({ id }) =>
      id === provider ? models : current.filter((model) => model.provider === id),
    );
    return true;
  });
}
