import type { AgentModelOption, AgentReasoningEffort, AgentSummary, UpdateAgentInput } from "@openbot/contracts/ipc";
import {
  CUSTOM_AGENT_DEFAULT_MODEL,
  CUSTOM_PROVIDER_HARNESSES,
  type CustomProviderHarness,
  customAgentIdOfModel,
  DEFAULT_CUSTOM_PROVIDER_HARNESS,
  defaultProviderModel,
  isCustomProviderHarness,
  isReasoningEffort,
  PICKER_PROVIDERS,
  savedCustomModelId,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Exit, Schema, Semaphore } from "effect";
import type { AgentProvider } from "../agent-client";
import { type AgentStore, DEFAULT_AGENT_PROVIDER } from "../agent-store";
import { causeHelpers } from "../effect-boundary";
import type { MailboxStore } from "../mailbox-store";
import type { ConversationRuntime } from "./conversation-runtime";
import { type ProviderPreference, startingModel } from "./model-choice";
import { newestOfFamily } from "./provider-models";
import type { ProviderRuntime } from "./provider-runtime";
import { providerForAgent } from "./thread-items";

export interface CustomEndpointsHooks {
  applyAgentUpdate(input: UpdateAgentInput): Effect.Effect<AgentSummary, EndpointChangeFailed>;
  queueAgentUpdate(input: UpdateAgentInput): Effect.Effect<AgentSummary, EndpointChangeFailed>;
  endpointHarness(endpointId: string): CustomProviderHarness | null;
  savedEndpoints(): ReadonlyMap<string, SavedEndpoint>;
  modelsChanged(): void;
  stopProfileClients(): Effect.Effect<void>;
  emitError(code: string, error: unknown, agentId?: string): void;
  providerAvailable(provider: AgentProvider): boolean;
  preference(): ProviderPreference;
}

interface SavedEndpoint {
  readonly harness: CustomProviderHarness;
  readonly modelIds: readonly string[];
}

function choiceKey(provider: string, model: string): string {
  return `${provider}\u0000${model}`;
}

function savesModel(saved: readonly string[], id: string): boolean {
  if (saved.includes(id)) return true;
  const separator = id.lastIndexOf("/");
  return separator > 0 && isReasoningEffort(id.slice(separator + 1)) && saved.includes(id.slice(0, separator));
}

export interface CustomEndpointsOptions {
  store: AgentStore;
  mailbox: MailboxStore;
  conversation: ConversationRuntime;
  providers: ProviderRuntime;
  hooks: CustomEndpointsHooks;
}

export class CustomEndpoints {
  readonly #store: AgentStore;
  readonly #mailbox: MailboxStore;
  readonly #conversation: ConversationRuntime;
  readonly #providers: ProviderRuntime;
  readonly #hooks: CustomEndpointsHooks;
  readonly #released: Record<CustomProviderHarness, Map<string, number>> = { opencode: new Map(), pi: new Map() };
  #revision = 0;
  #committedRevision = 0;
  readonly #chain = Semaphore.makeUnsafe(1);
  readonly #pendingMoves = new Map<string, { endpointId: string; harness: CustomProviderHarness }>();
  readonly #unlistedAtLastStart = new Map<string, string>();

  constructor(options: CustomEndpointsOptions) {
    this.#store = options.store;
    this.#mailbox = options.mailbox;
    this.#conversation = options.conversation;
    this.#providers = options.providers;
    this.#hooks = options.hooks;
  }

  available(): AgentModelOption[] {
    const listed = this.#providers.listModels();
    const added = this.#addedEndpointModels(listed);
    if (added.size === 0 && CUSTOM_PROVIDER_HARNESSES.every((harness) => this.#released[harness].size === 0))
      return listed;
    return listed.filter((option) => !added.has(option) && this.serves(option.id, option.provider));
  }

  #addedEndpointModels(listed: readonly AgentModelOption[]): ReadonlySet<AgentModelOption> {
    const added = new Set<AgentModelOption>();
    const endpoints = this.#hooks.savedEndpoints();
    if (endpoints.size === 0) return added;
    let inUse: ReadonlySet<string> | undefined;
    for (const option of listed) {
      if (!isCustomProviderHarness(option.provider)) continue;
      const separator = option.id.indexOf("/");
      if (separator <= 0) continue;
      const endpointId = option.id.slice(0, separator);
      const endpoint = endpoints.get(endpointId);
      if (endpoint?.harness !== option.provider) continue;
      if (savesModel(listedModelIds(endpointId, endpoint.harness, endpoint.modelIds), option.id)) continue;
      inUse ??= this.#modelsInUse();
      if (!inUse.has(choiceKey(option.provider, option.id))) added.add(option);
    }
    return added;
  }

  #modelsInUse(): ReadonlySet<string> {
    const keys = new Set<string>();
    const preference = this.#hooks.preference();
    if (preference.model !== null) keys.add(choiceKey(preference.provider, preference.model));
    for (const agent of this.#store.list()) {
      keys.add(choiceKey(providerForAgent(agent), agent.model));
      for (const choice of [agent.usageLimitReturn, agent.pendingRuntime, ...(agent.backupModels?.order ?? [])])
        if (choice) keys.add(choiceKey(choice.provider, choice.model));
    }
    return keys;
  }

  serves(modelId: string, provider: AgentProvider): boolean {
    return this.#releasedAt(modelId, provider) === null;
  }

  servesClient(modelId: string, provider: AgentProvider, configRevision: number | null): boolean {
    const releasedAt = this.#releasedAt(modelId, provider);
    if (releasedAt === null) return true;
    if (this.#hooks.endpointHarness(modelId.slice(0, modelId.indexOf("/"))) !== provider) return false;
    return (configRevision ?? this.#committedRevision) >= releasedAt;
  }

  #releasedAt(modelId: string, provider: AgentProvider): number | null {
    if (!isCustomProviderHarness(provider)) return null;
    const separator = modelId.indexOf("/");
    if (separator <= 0) return null;
    return this.#released[provider].get(modelId.slice(0, separator)) ?? null;
  }

  pending(harness: CustomProviderHarness): boolean {
    for (const providerId of this.#released[harness].keys()) {
      if (this.#hooks.endpointHarness(providerId) === harness) return true;
    }
    return false;
  }

  waits(harness: CustomProviderHarness, providerId: string): boolean {
    return this.#released[harness].has(providerId);
  }

  committedRevision(): number {
    return this.#committedRevision;
  }

  #release(providerId: string, harness: CustomProviderHarness): Record<CustomProviderHarness, number | undefined> {
    this.#revision += 1;
    const previous = { opencode: this.#released.opencode.get(providerId), pi: this.#released.pi.get(providerId) };
    const saved = this.#hooks.endpointHarness(providerId) ?? harness;
    for (const target of new Set([harness, saved])) this.#released[target].set(providerId, this.#revision);
    return previous;
  }

  #restore(providerId: string, previous: Record<CustomProviderHarness, number | undefined>): void {
    for (const harness of CUSTOM_PROVIDER_HARNESSES) {
      const revision = previous[harness];
      if (revision !== undefined) this.#released[harness].set(providerId, revision);
      else this.#released[harness].delete(providerId);
    }
  }

  runExclusive<T, E>(run: () => Effect.Effect<T, E>): Effect.Effect<T, E> {
    return this.#chain.withPermit(Effect.suspend(run));
  }

  readonly save = Effect.fn("CustomEndpoints.save")(function* <T>(
    this: CustomEndpoints,
    providerId: string,
    harness: CustomProviderHarness,
    persist: () => Effect.Effect<T, EndpointChangeFailed>,
  ) {
    return yield* this.#chain.withPermit(
      Effect.gen({ self: this }, function* () {
        const previous = this.#release(providerId, harness);
        const revision = this.#revision;
        this.#hooks.modelsChanged();
        yield* this.#hooks.stopProfileClients();
        const result = yield* Effect.exit(
          Effect.gen({ self: this }, function* () {
            const persisted = yield* Effect.suspend(persist);
            this.#committedRevision = revision;
            return persisted;
          }),
        );
        if (Exit.isSuccess(result)) return result.value;
        this.#restore(providerId, previous);
        this.#hooks.modelsChanged();
        return yield* Effect.failCause(result.cause);
      }),
    );
  }, Effect.uninterruptible);

  readonly update = Effect.fn("CustomEndpoints.update")(function* <T>(
    this: CustomEndpoints,
    providerId: string,
    harness: CustomProviderHarness,
    removedModelIds: readonly string[],
    persist: () => Effect.Effect<T, EndpointChangeFailed>,
  ) {
    return yield* this.#chain.withPermit(
      Effect.gen({ self: this }, function* () {
        yield* this.#moveOffRemovedModels(providerId, new Set(removedModelIds));
        const from = this.#hooks.endpointHarness(providerId);
        const previous = this.#release(providerId, harness);
        const revision = this.#revision;
        this.#hooks.modelsChanged();
        yield* this.#hooks.stopProfileClients();
        const result = yield* Effect.exit(
          Effect.gen({ self: this }, function* () {
            const persisted = yield* Effect.suspend(persist);
            this.#committedRevision = revision;
            return persisted;
          }),
        );
        if (Exit.isSuccess(result)) {
          if (from !== null && from !== harness) this.#recordMoves(providerId, from, harness);
          return result.value;
        }
        this.#restore(providerId, previous);
        this.#hooks.modelsChanged();
        return yield* Effect.failCause(result.cause);
      }),
    );
  }, Effect.uninterruptible);

  #recordMoves(endpointId: string, from: CustomProviderHarness, harness: CustomProviderHarness): void {
    for (const agent of this.#store.list()) {
      if (providerForAgent(agent) === from && endpointOfModel(agent.model) === endpointId) {
        this.#pendingMoves.set(agent.id, { endpointId, harness });
      }
    }
  }

  readonly #moveOffRemovedModels = Effect.fn("CustomEndpoints.moveOffRemovedModels")(function* (
    this: CustomEndpoints,
    providerId: string,
    removed: ReadonlySet<string>,
  ) {
    if (removed.size === 0) return;
    const prefix = `${providerId}/`;
    const removedIds = new Set(
      CUSTOM_PROVIDER_HARNESSES.flatMap((harness) => listedModelIds(providerId, harness, [...removed])),
    );
    const remaining = this.available().filter((option) => !removedIds.has(option.id));
    for (const harness of CUSTOM_PROVIDER_HARNESSES) {
      const affected = this.#store
        .list()
        .filter((agent) => providerForAgent(agent) === harness && removedIds.has(agent.model));
      if (affected.length === 0) continue;
      const fallback =
        remaining.find((option) => option.provider === harness && option.id.startsWith(prefix)) ??
        this.#harnessFallback(harness, remaining);
      if (!fallback) continue;
      yield* this.#moveAgents(affected, harness, fallback);
    }
  }, Effect.uninterruptible);

  #harnessFallback(harness: CustomProviderHarness, remaining: AgentModelOption[]): AgentModelOption | null {
    return (
      startingModel(harness, remaining, this.#hooks.preference()) ??
      (this.#hooks.providerAvailable(DEFAULT_AGENT_PROVIDER)
        ? startingModel(DEFAULT_AGENT_PROVIDER, remaining, this.#hooks.preference())
        : null)
    );
  }

  readonly #moveAgents = Effect.fn("CustomEndpoints.moveAgents")(function* (
    this: CustomEndpoints,
    affected: readonly AgentSummary[],
    harness: CustomProviderHarness,
    fallback: AgentModelOption,
  ) {
    if (fallback.provider !== harness && affected.some((agent) => this.#hasWorkInFlight(agent))) {
      return yield* new EndpointChangeFailed({ cause: new Error(sourceText("error.provider.endpointRemoveBusy")) });
    }
    for (const agent of affected) {
      yield* this.#hooks
        .applyAgentUpdate({
          agentId: agent.id,
          provider: fallback.provider,
          model: fallback.id,
          reasoningEffort: fallback.defaultReasoningEffort,
        })
        .pipe(toEndpointChangeFailed);
    }
  }, Effect.uninterruptible);

  readonly remove = Effect.fn("CustomEndpoints.remove")(function* <T>(
    this: CustomEndpoints,
    providerId: string,
    persist: () => Effect.Effect<T, EndpointChangeFailed>,
  ) {
    return yield* this.#chain.withPermit(
      Effect.gen({ self: this }, function* () {
        const previous = this.#release(
          providerId,
          this.#hooks.endpointHarness(providerId) ?? DEFAULT_CUSTOM_PROVIDER_HARNESS,
        );
        const revision = this.#revision;
        this.#hooks.modelsChanged();
        yield* this.#hooks.stopProfileClients();
        const result = yield* Effect.exit(
          Effect.gen({ self: this }, function* () {
            yield* this.#releaseModels(providerId);
            const persisted = yield* Effect.suspend(persist);
            this.#committedRevision = revision;
            return persisted;
          }),
        );
        if (Exit.isSuccess(result)) return result.value;
        this.#restore(providerId, previous);
        this.#hooks.modelsChanged();
        return yield* Effect.failCause(result.cause);
      }),
    );
  }, Effect.uninterruptible);

  readonly saveCustomAgent = Effect.fn("CustomEndpoints.saveCustomAgent")(function* <T>(
    this: CustomEndpoints,
    persist: () => Effect.Effect<T, EndpointChangeFailed>,
  ) {
    return yield* this.#chain.withPermit(
      Effect.gen({ self: this }, function* () {
        yield* this.#hooks.stopProfileClients();
        return yield* Effect.suspend(persist);
      }),
    );
  }, Effect.uninterruptible);

  readonly removeCustomAgent = Effect.fn("CustomEndpoints.removeCustomAgent")(function* <T>(
    this: CustomEndpoints,
    customAgentId: string,
    persist: () => Effect.Effect<T, EndpointChangeFailed>,
  ) {
    return yield* this.#chain.withPermit(
      Effect.gen({ self: this }, function* () {
        yield* this.#hooks.stopProfileClients();
        const affected = this.#store
          .list()
          .filter((agent) => providerForAgent(agent) === "acp" && customAgentIdOfModel(agent.model) === customAgentId);
        const fallback = affected.length > 0 ? this.#builtInFallback() : null;
        if (fallback) {
          if (affected.some((agent) => this.#hasWorkInFlight(agent))) {
            return yield* new EndpointChangeFailed({
              cause: new Error(sourceText("error.provider.customAgentRemoveBusy")),
            });
          }
          for (const agent of affected) {
            yield* this.#hooks
              .applyAgentUpdate({
                agentId: agent.id,
                provider: fallback.provider,
                model: fallback.id,
                reasoningEffort: fallback.defaultReasoningEffort,
              })
              .pipe(toEndpointChangeFailed);
          }
        }
        return yield* Effect.suspend(persist);
      }),
    );
  }, Effect.uninterruptible);

  #builtInFallback(): AgentModelOption | null {
    const remaining = this.available();
    const preference = this.#hooks.preference();
    const providers = [preference.provider, ...PICKER_PROVIDERS.filter((provider) => provider !== preference.provider)];
    for (const provider of providers) {
      if (provider === "acp" || !this.#hooks.providerAvailable(provider)) continue;
      const model = startingModel(provider, remaining, preference);
      if (model) return model;
    }
    return null;
  }

  clearReleased(harness: CustomProviderHarness, configRevision: number): void {
    let changed = false;
    const released = this.#released[harness];
    for (const [providerId, revision] of released) {
      if (revision > configRevision) continue;
      released.delete(providerId);
      changed = true;
    }
    if (changed) this.#hooks.modelsChanged();
  }

  readonly moveAgentsToHarness = Effect.fn("CustomEndpoints.moveAgentsToHarness")(function* (
    this: CustomEndpoints,
    harness: CustomProviderHarness,
  ) {
    const models = this.available().filter((model) => model.provider === harness);
    for (const agent of this.#waitingFor(harness)) {
      const moved = this.#modelOnHarness(agent, harness);
      const target = models.find((model) => model.id === moved);
      if (!target) continue;
      this.#pendingMoves.delete(agent.id);
      yield* this.#hooks
        .queueAgentUpdate({
          agentId: agent.id,
          provider: harness,
          model: target.id,
          reasoningEffort: target.defaultReasoningEffort,
        })
        .pipe(
          Effect.catch((failure) =>
            Effect.sync(() => this.#hooks.emitError("agent_model_fallback_failed", failure.cause, agent.id)),
          ),
        );
    }
  }, Effect.uninterruptible).bind(this);

  abandonMovesTo(harness: CustomProviderHarness): Effect.Effect<void> {
    return this.runExclusive(() =>
      Effect.gen({ self: this }, function* () {
        const dropped = new Map<AgentProvider, Set<string>>();
        for (const agent of this.#waitingFor(harness)) {
          this.#pendingMoves.delete(agent.id);
          const provider = providerForAgent(agent);
          dropped.set(provider, (dropped.get(provider) ?? new Set()).add(agent.id));
        }
        for (const [provider, agentIds] of dropped) yield* this.moveAgentsOffUnlistedModels(provider, agentIds);
      }),
    );
  }

  waitsForHarness(harness: CustomProviderHarness): boolean {
    return this.#waitingFor(harness).length > 0;
  }

  #modelOnHarness(agent: AgentSummary, harness: CustomProviderHarness): string {
    const from = providerForAgent(agent);
    const endpointId = endpointOfModel(agent.model);
    const endpoint = endpointId ? this.#hooks.savedEndpoints().get(endpointId) : undefined;
    if (!endpointId || !endpoint || !isCustomProviderHarness(from)) return agent.model;
    const id = endpoint.modelIds.find((modelId) => savedCustomModelId(endpointId, from, modelId) === agent.model);
    return id === undefined ? agent.model : savedCustomModelId(endpointId, harness, id);
  }

  #waitingFor(harness: CustomProviderHarness): AgentSummary[] {
    return this.#store.list().filter((agent) => {
      const move = this.#pendingMove(agent);
      return move !== null && move.harness === harness;
    });
  }

  #pendingMove(agent: AgentSummary): { endpointId: string; harness: CustomProviderHarness } | null {
    const move = this.#pendingMoves.get(agent.id);
    if (!move) return null;
    const applies =
      providerForAgent(agent) !== move.harness &&
      endpointOfModel(agent.model) === move.endpointId &&
      this.#hooks.endpointHarness(move.endpointId) === move.harness;
    if (applies) return move;
    this.#pendingMoves.delete(agent.id);
    return null;
  }

  readonly #releaseModels = Effect.fn("CustomEndpoints.releaseModels")(function* (
    this: CustomEndpoints,
    removedId: string,
  ) {
    const remaining = this.available();
    for (const harness of CUSTOM_PROVIDER_HARNESSES) {
      const affected = this.#store
        .list()
        .filter(
          (agent) =>
            providerForAgent(agent) === harness &&
            (!this.serves(agent.model, harness) || this.#pendingMove(agent)?.endpointId === removedId),
        );
      if (affected.length === 0) continue;
      const fallback = this.#harnessFallback(harness, remaining);
      if (!fallback) continue;
      yield* this.#moveAgents(affected, harness, fallback);
    }
  }, Effect.uninterruptible);

  hasAgentsOffList(provider: AgentProvider): boolean {
    const models = this.available().filter((model) => model.provider === provider);
    return models.length > 0 && this.#agentsOffList(provider, models).length > 0;
  }

  #agentsOffList(
    provider: AgentProvider,
    models: readonly AgentModelOption[],
    agentIds?: ReadonlySet<string>,
  ): AgentSummary[] {
    return this.#store.list().filter((agent) => {
      if (providerForAgent(agent) !== provider || (agentIds !== undefined && !agentIds.has(agent.id))) return false;
      const listed = this.#agentModels(provider, agent, models);
      return listed !== null && !listed.some((model) => model.id === agent.model) && this.#pendingMove(agent) === null;
    });
  }

  #agentModels(
    provider: AgentProvider,
    agent: AgentSummary,
    models: readonly AgentModelOption[],
  ): readonly AgentModelOption[] | null {
    if (!this.#providers.hasProviderAccount(provider, agent.providerAccountId ?? "")) return models;
    const own = this.#providers.listedAccountModels(provider, agent.providerAccountId);
    if (!own?.length) return null;
    return [...models, ...own.filter((model) => !models.some((listed) => listed.id === model.id))];
  }

  moveAccountAgentsOffUnlistedModels(provider: AgentProvider, accountId: string): Effect.Effect<void> {
    return this.runExclusive(() =>
      Effect.suspend(() => {
        const agentIds = new Set(
          this.#store
            .list()
            .filter((agent) => providerForAgent(agent) === provider && agent.providerAccountId === accountId)
            .map((agent) => agent.id),
        );
        return agentIds.size ? this.moveAgentsOffUnlistedModels(provider, agentIds) : Effect.void;
      }),
    );
  }

  moveAgentsOffModelsUnlistedTwice(provider: AgentProvider): Effect.Effect<void> {
    return Effect.suspend(() => {
      const models = this.available().filter((model) => model.provider === provider);
      if (models.length === 0) return Effect.void;
      const unlisted = new Map(this.#agentsOffList(provider, models).map((agent) => [agent.id, agent.model]));
      const twice = new Set<string>();
      for (const agent of this.#store.list()) {
        if (providerForAgent(agent) !== provider) continue;
        const model = unlisted.get(agent.id);
        if (model === undefined) this.#unlistedAtLastStart.delete(agent.id);
        else if (this.#unlistedAtLastStart.get(agent.id) === model) twice.add(agent.id);
        else this.#unlistedAtLastStart.set(agent.id, model);
      }
      return twice.size ? this.moveAgentsOffUnlistedModels(provider, twice) : Effect.void;
    });
  }

  readonly moveAgentsOffUnlistedModels = Effect.fn("CustomEndpoints.moveAgentsOffUnlistedModels")(function* (
    this: CustomEndpoints,
    provider: AgentProvider,
    agentIds?: ReadonlySet<string>,
  ) {
    const models = this.available().filter((model) => model.provider === provider);
    const providerFallback = models.find((model) => model.id === defaultProviderModel(provider)) ?? models[0];
    if (!providerFallback) return;
    for (const agent of this.#agentsOffList(provider, models, agentIds)) {
      const listed = this.#agentModels(provider, agent, models) ?? models;
      const variant = provider === "acp" ? null : effortVariant(listed, agent.model);
      const family = provider === "acp" || variant ? null : newestOfFamily(listed, agent.model);
      const fallback =
        variant?.model ??
        family ??
        (provider === "acp"
          ? listed.find((model) => sameCustomAgent(model.id, agent.model) && !isCustomAgentDefaultModel(model.id))
          : providerFallback);
      if (!fallback) continue;
      const keptEffort =
        family && family.reasoningEffortConfigurable !== false
          ? ([effortInModelId(agent.model), agent.reasoningEffort].find(
              (effort) => effort !== null && family.supportedReasoningEfforts.includes(effort),
            ) ?? null)
          : null;
      yield* this.#hooks
        .applyAgentUpdate({
          agentId: agent.id,
          model: fallback.id,
          reasoningEffort: variant?.effort ?? keptEffort ?? fallback.defaultReasoningEffort,
        })
        .pipe(toEndpointChangeFailed)
        .pipe(
          Effect.catch((failure) =>
            Effect.sync(() => this.#hooks.emitError("agent_model_fallback_failed", failure.cause, agent.id)),
          ),
        );
    }
  }, Effect.uninterruptible).bind(this);

  #hasWorkInFlight(agent: AgentSummary): boolean {
    if (this.#mailbox.hasUnfinishedDelivery(agent.id)) return true;
    const active =
      this.#conversation.workingSnapshot(agent.id)?.activeTurnId ??
      (agent.threadId ? this.#store.database.readConversationRuntime(agent.id, agent.threadId).activeTurnId : null);
    return Boolean(active);
  }
}

function listedModelIds(endpointId: string, harness: CustomProviderHarness, modelIds: readonly string[]): string[] {
  return modelIds.map((modelId) => savedCustomModelId(endpointId, harness, modelId));
}

function endpointOfModel(model: string): string | null {
  const separator = model.indexOf("/");
  return separator > 0 ? model.slice(0, separator) : null;
}

function isCustomAgentDefaultModel(model: string): boolean {
  return model.slice(model.indexOf("/") + 1) === CUSTOM_AGENT_DEFAULT_MODEL;
}

function sameCustomAgent(model: string, agentModel: string): boolean {
  const id = customAgentIdOfModel(model);
  return id !== null && id === customAgentIdOfModel(agentModel);
}

function effortVariant(
  models: readonly AgentModelOption[],
  modelId: string,
): { model: AgentModelOption; effort: AgentReasoningEffort } | null {
  for (const model of models) {
    if (model.reasoningEffortConfigurable === false || !modelId.startsWith(`${model.id}-`)) continue;
    const suffix = modelId.slice(model.id.length + 1);
    const effort = model.supportedReasoningEfforts.find((candidate) => candidate === suffix);
    if (effort) return { model, effort };
  }
  return null;
}

function effortInModelId(modelId: string): AgentReasoningEffort | null {
  return (
    modelId
      .toLowerCase()
      .split(/[-_]/u)
      .reverse()
      .find((part) => isReasoningEffort(part)) ?? null
  );
}

export class EndpointChangeFailed extends Schema.TaggedError<EndpointChangeFailed>()("EndpointChangeFailed", {
  cause: Schema.Defect(),
}) {}

export const { rewrap: toEndpointChangeFailed } = causeHelpers(EndpointChangeFailed);
