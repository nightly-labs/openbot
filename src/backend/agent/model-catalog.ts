import type { AgentModelOption } from "@openbot/contracts/ipc";
import { isAgentModel, isReasoningEffort } from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect } from "effect";
import type { AgentClient, AgentProvider } from "./../agent-client";
import { decodeModelListResponse, type ModelListResponse } from "./../protocol";
import { providerFailure } from "../provider-client-effects";
import { BUILT_IN_PROVIDER_DRIVERS, type ProviderClientContext } from "./../provider-drivers";
import {
  claudeModelName,
  compareModelVersions,
  FALLBACK_MODELS,
  isOpencodeModelUnusableWithStoredKey,
  modelDisplayName,
  modelsAfterOpenCodeDiscoveryFailure,
  OPENCODE_FREE_MODEL_FALLBACKS,
  PREFERRED_MODEL_ORDER,
} from "./provider-models";
import { isProviderTimeout } from "./provider-status";
import { providerLabel } from "./thread-items";

const logger = createOpenBotLogger("provider-runtime");
const MODEL_METADATA_FALLBACKS = [...FALLBACK_MODELS, ...OPENCODE_FREE_MODEL_FALLBACKS];

export interface ModelCatalogOptions {
  /** The running client of a provider, if it has one. */
  client(provider: AgentProvider): AgentClient | undefined;
  /** True while the provider's row says that the user must sign in. */
  isSignedOut(provider: AgentProvider): boolean;
  credentials: ProviderClientContext;
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
   * Reads the catalogue of every connected CLI, and answers which providers replied with a fresh one.
   *
   * A provider that has no client, or whose `model/list` failed or timed out, keeps the models it
   * already had. That is the right catalogue to keep answering with, but it is not proof of what the
   * process now running serves, so its id is absent from the set and no caller may treat it as proof.
   */
  readonly refresh = Effect.fn("ModelCatalog.refresh")(function* (this: ModelCatalog) {
    const discovered = yield* Effect.forEach(
      BUILT_IN_PROVIDER_DRIVERS,
      ({ id: provider }) =>
        Effect.gen({ self: this }, function* () {
          const previous = this.#models.filter((model) => model.provider === provider);
          const client = this.#options.client(provider);
          const signedOut = this.#options.isSignedOut(provider);
          // Do not expose fallback or stale models when OpenCode reports sign-in-required. A client
          // in the map has an account: activation refreshes the catalog before it marks the
          // provider available, so the old status alone does not mean signed out.
          if (provider === "opencode" && signedOut && !client) return { provider, models: [], fresh: false };
          if (!client) return { provider, models: previous, fresh: false };
          // Read once per pass, not per model: a stored key cannot change inside one refresh, and
          // a model is unusable only because OpenBot is what put that key in the environment.
          const hasStoredKey = Boolean(this.#options.credentials.apiKey(provider));
          const startedAt = performance.now();
          return yield* Effect.gen({ self: this }, function* () {
            const serverModels = new Map<string, ModelListResponse["data"][number]>();
            const cursors = new Set<string>();
            let cursor: string | undefined;
            do {
              const response = yield* client.request(
                "model/list",
                { limit: 100, includeHidden: true, ...(cursor ? { cursor } : {}) },
                decodeModelListResponse,
                // A custom agent can need more than 5 s to start and open a probe session in
                // `initialize` and again in `model/list`: Claude Agent ACP with a few plugins and MCP
                // servers does. It answers inside the normal timeout, and a list that timed out kept
                // that agent out of the catalogue.
                client.provider === "acp" ? this.#options.requestTimeoutMs : 5_000,
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
              cursor = client.provider === "codex" ? response.nextCursor : undefined;
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
              // Claude Code is the exception, and `claudeModelName` says why.
              // Clamped, because a name over the limit is not a long name downstream: it fails
              // `isAgentModelOption`, and the IPC and Team API list decoders fail closed on the
              // whole array, so one over-long name empties the picker. OpenCode is the CLI that
              // reaches it - it names a custom model `"<provider name>/<model name>"`, and 80 plus
              // 160 characters passes 160 - but the clamp protects every CLI.
              const name = modelDisplayName(
                (client.provider === "claude" ? claudeModelName(server.model) : null) ||
                  server.displayName?.trim() ||
                  fallback?.name ||
                  server.model,
              );
              // The stored key is an OpenCode Go key, so the Zen models the key also lists never
              // reach the picker. With no key stored the same models can only come from the user's
              // own OpenCode sign-in, which does buy them. Decided here, on the resolved name, so
              // the catalog and the picker's Free badge cannot disagree about what costs money.
              if (provider === "opencode" && hasStoredKey && isOpencodeModelUnusableWithStoredKey(server.model, name)) {
                continue;
              }
              models.push({
                provider: client.provider,
                id: server.model,
                name,
                description:
                  fallback?.description ?? `${providerLabel(client.provider)} model discovered from the local CLI.`,
                defaultReasoningEffort: isReasoningEffort(server?.defaultReasoningEffort)
                  ? server.defaultReasoningEffort
                  : (fallback?.defaultReasoningEffort ?? "medium"),
                supportedReasoningEfforts: efforts.length
                  ? efforts
                  : (fallback?.supportedReasoningEfforts ?? ["medium"]),
                ...(server.reasoningEffortConfigurable === false ? { reasoningEffortConfigurable: false } : {}),
              });
            }
            const rank = PREFERRED_MODEL_ORDER.get(client.provider) ?? (() => 0);
            // Tier first, then newest first. Sort is stable, so the CLI's own order still decides
            // between models of one version.
            const sorted = [...models].sort(
              (left, right) => rank(left) - rank(right) || compareModelVersions(left, right),
            );
            // A successful but empty OpenCode response is no more useful to the picker than a
            // timeout: it must not erase the built-in free tier on first discovery. Keep the last
            // known catalog when available, otherwise seed the OpenCode safety net. It is not a
            // fresh catalog, so callers must not treat it as proof that this process serves it.
            // A response that the stored-key filter emptied is a real answer: restoring the last
            // catalog would bring back the models that the key cannot use.
            logger.info("A provider listed its models.", {
              provider,
              count: sorted.length,
              durationMs: Math.round(performance.now() - startedAt),
            });
            if (client.provider === "opencode" && serverModels.size === 0) {
              return { provider, models: modelsAfterOpenCodeDiscoveryFailure(previous), fresh: false };
            }
            return { provider, models: sorted, fresh: true };
          }).pipe(
            Effect.catch((failure) => {
              this.#options.recordProviderError(provider, failure.cause);
              logger.warn("A provider did not list its models.", {
                provider,
                durationMs: Math.round(performance.now() - startedAt),
                timeout: isProviderTimeout(failure.cause),
              });
              return Effect.succeed({
                provider,
                models: provider === "opencode" ? modelsAfterOpenCodeDiscoveryFailure(previous) : previous,
                fresh: false,
              });
            }),
          );
        }),
      { concurrency: "unbounded" },
    );
    this.#models = discovered.flatMap((entry) => entry.models);
    return new Set(discovered.filter((entry) => entry.fresh).map((entry) => entry.provider));
  });
}
