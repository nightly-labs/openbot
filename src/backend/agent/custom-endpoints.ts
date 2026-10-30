import type { AgentModelOption, AgentReasoningEffort, AgentSummary, UpdateAgentInput } from "@openbot/contracts/ipc";
import {
  CUSTOM_AGENT_DEFAULT_MODEL,
  CUSTOM_PROVIDER_HARNESSES,
  type CustomProviderHarness,
  customAgentIdOfModel,
  DEFAULT_CUSTOM_PROVIDER_HARNESS,
  defaultProviderModel,
  isCustomProviderHarness,
  PICKER_PROVIDERS,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Exit, Schema, Semaphore } from "effect";
import type { AgentProvider } from "../agent-client";
import { type AgentStore, DEFAULT_AGENT_PROVIDER } from "../agent-store";
import { causeHelpers } from "../effect-boundary";
import type { MailboxStore } from "../mailbox-store";
import type { ConversationRuntime } from "./conversation-runtime";
import { type ProviderPreference, startingModel } from "./model-choice";
import type { ProviderRuntime } from "./provider-runtime";
import { providerForAgent } from "./thread-items";

export interface CustomEndpointsHooks {
  /** The facade's agent update without the chain: every caller here already holds it. */
  applyAgentUpdate(input: UpdateAgentInput): Effect.Effect<AgentSummary, EndpointChangeFailed>;
  /** The same update, but a provider change for a busy agent waits for its next turn. */
  queueAgentUpdate(input: UpdateAgentInput): Effect.Effect<AgentSummary, EndpointChangeFailed>;
  /** The harness that runs a saved endpoint, or null for an id no endpoint has. */
  endpointHarness(endpointId: string): CustomProviderHarness | null;
  /** Tells the renderer to read the catalogue again. */
  modelsChanged(): void;
  stopProfileClients(): Effect.Effect<void>;
  emitError(code: string, error: unknown, agentId?: string): void;
  providerAvailable(provider: AgentProvider): boolean;
  preference(): ProviderPreference;
}

export interface CustomEndpointsOptions {
  store: AgentStore;
  mailbox: MailboxStore;
  conversation: ConversationRuntime;
  providers: ProviderRuntime;
  hooks: CustomEndpointsHooks;
}

/**
 * Owns the custom endpoint changes and what they hide: the endpoints excluded from the catalogue,
 * the revision counters that put an exclusion and a spawn in order, and the chain that runs one
 * endpoint change or one agent update at a time. It also moves agents off models a provider no
 * longer lists.
 *
 * It never imports the agent service facade.
 */
export class CustomEndpoints {
  readonly #store: AgentStore;
  readonly #mailbox: MailboxStore;
  readonly #conversation: ConversationRuntime;
  readonly #providers: ProviderRuntime;
  readonly #hooks: CustomEndpointsHooks;
  /**
   * Endpoints the running CLI may still list although the saved file no longer defines them, because
   * a restart it refused or failed leaves its catalogue as it was. The value is `#revision`
   * as it stood when the exclusion was taken, so a process that spawned before that number read the
   * old files and its catalogue says nothing about this endpoint.
   *
   * Kept for each harness: OpenCode and Pi each spawn with the endpoints, and each reads a change only
   * when it restarts. An endpoint that moves to the other harness stays out of both catalogues until
   * each has restarted.
   */
  readonly #released: Record<CustomProviderHarness, Map<string, number>> = { opencode: new Map(), pi: new Map() };
  /**
   * Counts the endpoint changes, which puts an exclusion and a spawn in order. A CLI reads the files
   * once, at spawn, so a removal made while a process starts is not in the process that arrives.
   */
  #revision = 0;
  /**
   * The newest revision whose file write finished, which is the newest a spawning process can read.
   * A removal is excluded before its write, so a process that starts during the write reads the old
   * file and must not be taken as proof that the endpoint is gone.
   */
  #committedRevision = 0;
  /**
   * One endpoint change or one agent update at a time. A removal excludes the endpoint, moves the
   * agents off it and then writes the file; an agent update that ran between those steps could put
   * an agent back onto the endpoint after the sweep and before the write, and the removal would not
   * notice. Both paths run here, so neither can start inside the other.
   */
  readonly #chain = Semaphore.makeUnsafe(1);
  /**
   * The agents an edit left on the harness their endpoint no longer runs on, with that endpoint and
   * the harness it moved to. Taken when the edit is written, because an endpoint id can also name a
   * provider of the harness's own: `openai/gpt-5` on OpenCode is not the `openai` endpoint's model
   * when that endpoint is saved later. Kept in memory only: after a restart no harness lists the
   * endpoint on its old provider, and the agent moves to a fallback of the provider it is on.
   */
  readonly #pendingMoves = new Map<string, { endpointId: string; harness: CustomProviderHarness }>();

  constructor(options: CustomEndpointsOptions) {
    this.#store = options.store;
    this.#mailbox = options.mailbox;
    this.#conversation = options.conversation;
    this.#providers = options.providers;
    this.#hooks = options.hooks;
  }

  /**
   * The catalogue every caller may choose from: what the connected providers report, less the models
   * of an endpoint whose removal is written.
   *
   * The two lists differ only while OpenCode keeps running with an old configuration, which is what
   * a removal during a turn leaves behind. The CLI still lists the endpoint, so the raw catalogue
   * would let the renderer show it, `updateAgent` accept it, and a new agent start on it, all after
   * the file that defines it is gone. `alsoExcluded` names an endpoint whose removal is in progress
   * and therefore not recorded yet.
   */
  available(): AgentModelOption[] {
    if (CUSTOM_PROVIDER_HARNESSES.every((harness) => this.#released[harness].size === 0))
      return this.#providers.listModels();
    // A custom agent id can be the same text as an endpoint id. Its models are not the endpoint's.
    return this.#providers.listModels().filter((option) => this.serves(option.id, option.provider));
  }

  /**
   * Whether `provider` serves the model id as a save defines it. A model of no custom endpoint, and a
   * model of an endpoint nothing removed, are served; a model an endpoint no longer lists is not.
   * Only OpenCode and Pi run endpoints, so the models of another provider are always served.
   */
  serves(modelId: string, provider: AgentProvider): boolean {
    if (!isCustomProviderHarness(provider)) return true;
    const separator = modelId.indexOf("/");
    if (separator <= 0) return true;
    return !this.#released[provider].has(modelId.slice(0, separator));
  }

  /** The newest revision a spawning process can read, taken when a provider client starts. */
  committedRevision(): number {
    return this.#committedRevision;
  }

  /**
   * Takes the exclusion of one endpoint id on `harness` and on the harness that runs it now, and
   * answers what it replaced. Only these two restart for the change, and only a restart gives an
   * exclusion back. The id can also name a provider of the other harness's own, whose models stay.
   */
  #release(providerId: string, harness: CustomProviderHarness): Record<CustomProviderHarness, number | undefined> {
    this.#revision += 1;
    const previous = { opencode: this.#released.opencode.get(providerId), pi: this.#released.pi.get(providerId) };
    const saved = this.#hooks.endpointHarness(providerId) ?? harness;
    for (const target of new Set([harness, saved])) this.#released[target].set(providerId, this.#revision);
    return previous;
  }

  /** Gives back what `#release` replaced, after a change that wrote nothing. */
  #restore(providerId: string, previous: Record<CustomProviderHarness, number | undefined>): void {
    for (const harness of CUSTOM_PROVIDER_HARNESSES) {
      const revision = previous[harness];
      if (revision !== undefined) this.#released[harness].set(providerId, revision);
      else this.#released[harness].delete(providerId);
    }
  }

  /** A failed change does not stop the next one, so the chain swallows what it re-throws here. */
  runExclusive<T, E>(run: () => Effect.Effect<T, E>): Effect.Effect<T, E> {
    return this.#chain.withPermit(Effect.suspend(run));
  }

  /**
   * Saves one endpoint: the exclusion of the id being saved and `persist`, which is the caller's file
   * write, as one change nothing else can interleave with.
   *
   * The id is excluded although it is being added. The process answering now was spawned before this
   * write, and an id this app has never saved can still exist in OpenCode's own configuration and in
   * its live catalogue. Without the exclusion the picker reads those models as the saved endpoint's,
   * while every prompt still goes to the old process, at the URL and with the credentials it started
   * with. The exclusion is given back only when a process that read this write reports its own
   * catalogue, so a restart that is skipped for a busy CLI, or one that fails, leaves it in place.
   *
   * No agent is moved off the id, unlike a removal: the endpoint is arriving, not going away, and a
   * fresh process usually serves it within seconds. Until then its models are refused at delivery,
   * which is the safe answer while two different servers could answer to one id.
   */

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
        // The same reason as a removal: a profile or channel client is a process of its own, holding
        // the endpoints it was spawned with, and no restart of the main client reaches it.
        yield* this.#hooks.stopProfileClients();
        const result = yield* Effect.exit(
          Effect.gen({ self: this }, function* () {
            const persisted = yield* Effect.suspend(persist);
            // Only now can a spawning process read the saved endpoint.
            this.#committedRevision = revision;
            return persisted;
          }),
        );
        if (Exit.isSuccess(result)) return result.value;
        // Nothing was written, so the id is served exactly as it was before this call.
        this.#restore(providerId, previous);
        this.#hooks.modelsChanged();
        return yield* Effect.failCause(result.cause);
      }),
    );
  }, Effect.uninterruptible);

  /**
   * Changes one saved endpoint: the agents on a model it no longer lists, the exclusion of its id,
   * and `persist`, which is the caller's file write, as one change nothing else can interleave with.
   *
   * The agents move first, while the kept models are still served, so an agent on a removed model
   * moves to a kept model of the same endpoint and keeps its provider and thread. The id is then
   * excluded as for a save: the running process still has the old address and credentials, and
   * only a process that read this write may serve the endpoint again.
   */

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

  /** The agents on the endpoint's models on `from`, which move to `harness` once it lists them. */
  #recordMoves(endpointId: string, from: CustomProviderHarness, harness: CustomProviderHarness): void {
    for (const agent of this.#store.list()) {
      if (providerForAgent(agent) === from && endpointOfModel(agent.model) === endpointId) {
        this.#pendingMoves.set(agent.id, { endpointId, harness });
      }
    }
  }

  /**
   * The agents on `providerId/<removed>` go to a kept model of the same endpoint when the catalogue
   * lists one, then to the fallback a removal uses. Busy agents stop the change only when the move
   * is a provider switch.
   */
  readonly #moveOffRemovedModels = Effect.fn("CustomEndpoints.moveOffRemovedModels")(function* (
    this: CustomEndpoints,
    providerId: string,
    removed: ReadonlySet<string>,
  ) {
    if (removed.size === 0) return;
    const prefix = `${providerId}/`;
    const remaining = this.available().filter(
      (option) => !(option.id.startsWith(prefix) && removed.has(option.id.slice(prefix.length))),
    );
    // Each harness moves its own agents, so a kept model of the endpoint keeps the agent's provider.
    for (const harness of CUSTOM_PROVIDER_HARNESSES) {
      const affected = this.#store
        .list()
        .filter(
          (agent) =>
            providerForAgent(agent) === harness &&
            agent.model.startsWith(prefix) &&
            removed.has(agent.model.slice(prefix.length)),
        );
      if (affected.length === 0) continue;
      const fallback =
        remaining.find((option) => option.provider === harness && option.id.startsWith(prefix)) ??
        this.#harnessFallback(harness, remaining);
      if (!fallback) continue;
      yield* this.#moveAgents(affected, harness, fallback);
    }
  }, Effect.uninterruptible);

  /** The harness's own starting model, then the built-in default provider's while it is usable. */
  #harnessFallback(harness: CustomProviderHarness, remaining: AgentModelOption[]): AgentModelOption | null {
    return (
      startingModel(harness, remaining, this.#hooks.preference()) ??
      (this.#hooks.providerAvailable(DEFAULT_AGENT_PROVIDER)
        ? startingModel(DEFAULT_AGENT_PROVIDER, remaining, this.#hooks.preference())
        : null)
    );
  }

  /**
   * Moves the agents of one harness to `fallback`. A move to another provider is a provider switch,
   * which is refused during a turn or a queued delivery, so it stops the change before any agent moves.
   */
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
      // Not the public `updateAgent`: this already runs inside the chain that one takes.
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

  /**
   * Removes one endpoint: the exclusion, the agents that were on it, and `persist`, which is the
   * caller's file write, as one change nothing else can interleave with.
   *
   * The exclusion is taken *first*, so no agent can be moved onto the endpoint while its removal
   * runs, and given back when the write throws: an endpoint that is still on disk is still saved and
   * still served, and its models stay a valid fallback for the next removal.
   */

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
        // A profile or channel client is a process of its own, spawned with the endpoints as they
        // were, and no restart of the main client reaches it. It is one short request, so it is
        // stopped rather than watched: its caller reports a failure the user can repeat.
        yield* this.#hooks.stopProfileClients();
        const result = yield* Effect.exit(
          Effect.gen({ self: this }, function* () {
            yield* this.#releaseModels(providerId);
            const persisted = yield* Effect.suspend(persist);
            // Only now is the removal on disk, so only now can a process read it. Removals run one at a
            // time on the chain, so this number never goes back.
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

  /**
   * Saves one custom agent: `persist`, the caller's file write, inside the chain. No agent moves: an
   * agent on a model the changed agent no longer lists moves to another model of the same agent when
   * the new process lists its models (`moveAgentsOffUnlistedModels`).
   */

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

  /**
   * Removes one custom agent: the agents on it move to another provider, then `persist` writes the
   * file. The move comes first, as for an endpoint, so no agent is left on a program that is gone.
   * With nothing to move to, the removal still goes ahead, and those agents ask for a model at their
   * next turn.
   */

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

  /** The model an agent moves to when its custom agent goes: the preferred provider's, then the others'. */
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

  /**
   * A fresh OpenCode process is the one the app uses now, and it read the endpoint files as they are,
   * so what it lists is the truth and nothing has to be masked any more.
   *
   * Only a client that reached `onProviderActivated` gets here. A restart that fails leaves the old
   * process answering, on the endpoints it started with, and every id removed since then stays out:
   * an id saved a second time may name another server, and the old process would take the message to
   * the one the user has just replaced.
   */
  clearReleased(harness: CustomProviderHarness, configRevision: number): void {
    let changed = false;
    const released = this.#released[harness];
    for (const [providerId, revision] of released) {
      // A removal made while this process started is not in the files it read, so its catalogue is
      // the one from before the removal and the endpoint stays out.
      if (revision > configRevision) continue;
      released.delete(providerId);
      changed = true;
    }
    if (changed) this.#hooks.modelsChanged();
  }

  /**
   * Moves the agents on an endpoint that now runs on `harness` from the other harness to the same
   * model here, once this harness lists it. The agent keeps its workspace and identity; its thread is
   * handed over as for any provider change. A busy agent moves before its next turn.
   */

  readonly moveAgentsToHarness = Effect.fn("CustomEndpoints.moveAgentsToHarness")(function* (
    this: CustomEndpoints,
    harness: CustomProviderHarness,
  ) {
    const models = this.available().filter((model) => model.provider === harness);
    for (const agent of this.#waitingFor(harness)) {
      const target = models.find((model) => model.id === agent.model);
      if (!target) continue;
      this.#pendingMoves.delete(agent.id);
      yield* this.#hooks
        .queueAgentUpdate({
          agentId: agent.id,
          provider: harness,
          model: target.id,
          // The efforts are the harness's own: Pi registers an endpoint's models without reasoning.
          reasoningEffort: target.defaultReasoningEffort,
        })
        .pipe(
          Effect.catch((failure) =>
            Effect.sync(() => this.#hooks.emitError("agent_model_fallback_failed", failure.cause, agent.id)),
          ),
        );
    }
  }, Effect.uninterruptible).bind(this);

  /**
   * Drops the moves that wait for `harness` when it did not start. Those agents are on a model that
   * their harness no longer lists, so they move to a model that it lists, as after a restart of OpenBot.
   * It runs in the chain, so an edit that moves the endpoint back drops the moves first.
   */
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

  /** Whether agents wait for `harness` to start, to move there with `moveAgentsToHarness`. */
  waitsForHarness(harness: CustomProviderHarness): boolean {
    return this.#waitingFor(harness).length > 0;
  }

  /** The agents that an edit left on another harness, whose endpoint now runs on `harness`. */
  #waitingFor(harness: CustomProviderHarness): AgentSummary[] {
    return this.#store.list().filter((agent) => {
      const move = this.#pendingMove(agent);
      return move !== null && move.harness === harness;
    });
  }

  /**
   * The recorded move of an agent while it still applies. One the user overtook -- another model, a
   * switch of provider, the endpoint removed or moved again -- is dropped.
   */
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

  /**
   * Moves every agent off a removed endpoint's models, onto a model that is still served.
   *
   * Runs *before* the file write and the restart, so no agent is left naming a model the fresh
   * catalogue does not list, and inside `removeCustomProvider`, which has already excluded the
   * endpoint and holds the chain that keeps an agent update out.
   *
   * Throws while an affected agent is busy, which stops the removal: the move is a provider switch,
   * and that is refused during a turn or a queued delivery. The check runs over all of them first,
   * so a refusal moves no agent at all.
   */
  readonly #releaseModels = Effect.fn("CustomEndpoints.releaseModels")(function* (
    this: CustomEndpoints,
    removedId: string,
  ) {
    // Every endpoint already removed, not only this one. A removal during a turn leaves the running
    // CLI's catalogue as it was, so the models of an endpoint already taken out are still listed,
    // and choosing one here would move agents onto an endpoint that is gone.
    const remaining = this.available();
    for (const harness of CUSTOM_PROVIDER_HARNESSES) {
      const affected = this.#store.list().filter(
        (agent) =>
          providerForAgent(agent) === harness &&
          // An agent that waits to move to the removed endpoint's harness is on a model that its
          // harness no longer lists, and only the removed endpoint's harness restarts.
          (!this.serves(agent.model, harness) || this.#pendingMove(agent)?.endpointId === removedId),
      );
      if (affected.length === 0) continue;
      // OpenCode declares no default model of its own -- its catalogue is whatever the CLI lists -- so
      // the fallback is chosen from the live list with the endpoint being removed taken out of it.
      // The built-in default provider comes second, because an agent left on a model the CLI no longer
      // serves cannot answer, and a provider switch keeps its workspace, thread and identity.
      // The built-in default is offered only while it is usable: `#applyAgentUpdate` connects the
      // provider it moves an agent to, and a Codex that is not installed or not signed in throws
      // there. That would trap a user who runs custom endpoints only, because the last endpoint could
      // never be removed while an agent still names one of its models.
      const fallback = this.#harnessFallback(harness, remaining);
      // Nothing is listed, so there is no model to move to. The removal still goes ahead: refusing it
      // would trap the user on an endpoint that may be the reason no model is listed.
      if (!fallback) continue;
      yield* this.#moveAgents(affected, harness, fallback);
    }
  }, Effect.uninterruptible);

  /**
   * Moves each agent of `provider` whose model the provider no longer lists to the provider's default,
   * or to the first model it lists when the default is gone too. A saved model that is a listed model
   * with one of its efforts (`effortVariant`) moves to that model and effort instead.
   *
   * Only called with a catalogue the provider has just reported, because a stale one is no proof that
   * a model is gone. The provider stays the same, so the agent keeps its thread, and a running turn
   * keeps the model it started with. An empty catalogue moves nobody: that is a provider with no
   * usable account, not a provider with no models.
   */

  readonly moveAgentsOffUnlistedModels = Effect.fn("CustomEndpoints.moveAgentsOffUnlistedModels")(function* (
    this: CustomEndpoints,
    provider: AgentProvider,
    /** Only these agents, when given. */
    agentIds?: ReadonlySet<string>,
  ) {
    const models = this.available().filter((model) => model.provider === provider);
    const providerFallback = models.find((model) => model.id === defaultProviderModel(provider)) ?? models[0];
    if (!providerFallback) return;
    const affected = this.#store.list().filter(
      (agent) =>
        providerForAgent(agent) === provider &&
        (agentIds === undefined || agentIds.has(agent.id)) &&
        !models.some((model) => model.id === agent.model) &&
        // An agent whose endpoint moved waits for `moveAgentsToHarness`, which keeps its model.
        this.#pendingMove(agent) === null,
    );
    for (const agent of affected) {
      // A custom agent is a program of its own, not a model: an agent moves only to another model of
      // the same custom agent. One that listed nothing, or did not answer, keeps its model. The router
      // lists `<agent>/default` for an agent that answered with an empty list, which a slow start
      // gives too, so that model is no proof that the saved one is gone.
      const variant = provider === "acp" ? null : effortVariant(models, agent.model);
      const fallback =
        variant?.model ??
        (provider === "acp"
          ? models.find((model) => sameCustomAgent(model.id, agent.model) && !isCustomAgentDefaultModel(model.id))
          : providerFallback);
      if (!fallback) continue;
      yield* this.#hooks
        .applyAgentUpdate({
          agentId: agent.id,
          model: fallback.id,
          reasoningEffort: variant?.effort ?? fallback.defaultReasoningEffort,
        })
        .pipe(toEndpointChangeFailed)
        .pipe(
          Effect.catch((failure) =>
            Effect.sync(() => this.#hooks.emitError("agent_model_fallback_failed", failure.cause, agent.id)),
          ),
        );
    }
  }, Effect.uninterruptible).bind(this);

  /**
   * Whether a turn is running for this agent or a delivery is still queued for it. Read from the
   * live snapshot first, then from the stored conversation, because an agent whose thread is not
   * loaded keeps its active turn in the database.
   */
  #hasWorkInFlight(agent: AgentSummary): boolean {
    if (this.#mailbox.hasUnfinishedDelivery(agent.id)) return true;
    const active =
      this.#conversation.workingSnapshot(agent.id)?.activeTurnId ??
      (agent.threadId ? this.#store.database.readConversationRuntime(agent.id, agent.threadId).activeTurnId : null);
    return Boolean(active);
  }
}

/** The endpoint id before a model id's first `/`, or null for a model id without one. */
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

/**
 * The listed model and effort that a saved model ID names as `<model>-<effort>`.
 *
 * Antigravity 1.3.0 and later list `gemini-3.1-pro` with a Low and a High effort. Earlier versions of
 * OpenBot listed and saved each effort as a model of its own, `gemini-3.1-pro-high`. An agent saved on
 * one of these keeps its model and effort. Only an effort that the listed model offers matches.
 */
function effortVariant(
  models: AgentModelOption[],
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

export class EndpointChangeFailed extends Schema.TaggedError<EndpointChangeFailed>()("EndpointChangeFailed", {
  cause: Schema.Defect(),
}) {}

export const { rewrap: toEndpointChangeFailed } = causeHelpers(EndpointChangeFailed);
