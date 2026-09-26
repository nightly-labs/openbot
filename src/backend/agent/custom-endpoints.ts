import type { AgentModelOption, AgentSummary, UpdateAgentInput } from "@openbot/contracts/ipc";
import { defaultProviderModel } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import type { AgentProvider } from "../agent-client";
import { type AgentStore, DEFAULT_AGENT_PROVIDER } from "../agent-store";
import type { MailboxStore } from "../mailbox-store";
import type { ConversationRuntime } from "./conversation-runtime";
import { type ProviderPreference, startingModel } from "./model-choice";
import type { ProviderRuntime } from "./provider-runtime";
import { providerForAgent } from "./thread-items";

export interface CustomEndpointsHooks {
  /** The facade's agent update without the chain: every caller here already holds it. */
  applyAgentUpdate(input: UpdateAgentInput): Promise<AgentSummary>;
  /** Tells the renderer to read the catalogue again. */
  modelsChanged(): void;
  stopProfileClients(): void;
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
   */
  readonly #released = new Map<string, number>();
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
  #chain: Promise<unknown> = Promise.resolve();

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
    if (this.#released.size === 0) return this.#providers.listModels();
    return this.#providers.listModels().filter((option) => this.serves(option.id));
  }

  /**
   * Whether the model id is one a save still defines. A model of no custom endpoint, and a model of
   * an endpoint nothing removed, are served; a model an endpoint no longer lists is not.
   */
  serves(modelId: string): boolean {
    const separator = modelId.indexOf("/");
    if (separator <= 0) return true;
    return !this.#released.has(modelId.slice(0, separator));
  }

  /** The newest revision a spawning process can read, taken when a provider client starts. */
  committedRevision(): number {
    return this.#committedRevision;
  }

  /** A failed change does not stop the next one, so the chain swallows what it re-throws here. */
  runExclusive<T>(run: () => Promise<T>): Promise<T> {
    const operation = this.#chain.then(run);
    this.#chain = operation.catch(() => undefined);
    return operation;
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
  save<T>(providerId: string, persist: () => Promise<T>): Promise<T> {
    return this.runExclusive(async () => {
      const previous = this.#released.get(providerId);
      this.#revision += 1;
      const revision = this.#revision;
      this.#released.set(providerId, revision);
      this.#hooks.modelsChanged();
      // The same reason as a removal: a profile or channel client is a process of its own, holding
      // the endpoints it was spawned with, and no restart of the main client reaches it.
      this.#hooks.stopProfileClients();
      try {
        const persisted = await persist();
        // Only now can a spawning process read the saved endpoint.
        this.#committedRevision = revision;
        return persisted;
      } catch (error) {
        // Nothing was written, so the id is served exactly as it was before this call.
        if (previous !== undefined) this.#released.set(providerId, previous);
        else this.#released.delete(providerId);
        this.#hooks.modelsChanged();
        throw error;
      }
    });
  }

  /**
   * Removes one endpoint: the exclusion, the agents that were on it, and `persist`, which is the
   * caller's file write, as one change nothing else can interleave with.
   *
   * The exclusion is taken *first*, so no agent can be moved onto the endpoint while its removal
   * runs, and given back when the write throws: an endpoint that is still on disk is still saved and
   * still served, and its models stay a valid fallback for the next removal.
   */
  remove<T>(providerId: string, persist: () => Promise<T>): Promise<T> {
    return this.runExclusive(async () => {
      const previous = this.#released.get(providerId);
      this.#revision += 1;
      const revision = this.#revision;
      this.#released.set(providerId, revision);
      this.#hooks.modelsChanged();
      // A profile or channel client is a process of its own, spawned with the endpoints as they
      // were, and no restart of the main client reaches it. It is one short request, so it is
      // stopped rather than watched: its caller reports a failure the user can repeat.
      this.#hooks.stopProfileClients();
      try {
        await this.#releaseModels();
        const persisted = await persist();
        // Only now is the removal on disk, so only now can a process read it. Removals run one at a
        // time on the chain, so this number never goes back.
        this.#committedRevision = revision;
        return persisted;
      } catch (error) {
        if (previous !== undefined) this.#released.set(providerId, previous);
        else this.#released.delete(providerId);
        this.#hooks.modelsChanged();
        throw error;
      }
    });
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
  clearReleased(configRevision: number): void {
    let changed = false;
    for (const [providerId, revision] of this.#released) {
      // A removal made while this process started is not in the files it read, so its catalogue is
      // the one from before the removal and the endpoint stays out.
      if (revision > configRevision) continue;
      this.#released.delete(providerId);
      changed = true;
    }
    if (changed) this.#hooks.modelsChanged();
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
  async #releaseModels(): Promise<void> {
    // Every endpoint already removed, not only this one. A removal during a turn leaves the running
    // CLI's catalogue as it was, so the models of an endpoint already taken out are still listed,
    // and choosing one here would move agents onto an endpoint that is gone.
    const affected = this.#store
      .list()
      .filter((agent) => providerForAgent(agent) === "opencode" && !this.serves(agent.model));
    if (affected.length === 0) return;
    // OpenCode declares no default model of its own -- its catalogue is whatever the CLI lists -- so
    // the fallback is chosen from the live list with the endpoint being removed taken out of it.
    // The built-in default provider comes second, because an agent left on a model the CLI no longer
    // serves cannot answer, and a provider switch keeps its workspace, thread and identity.
    const remaining = this.available();
    // The built-in default is offered only while it is usable: `#applyAgentUpdate` connects the
    // provider it moves an agent to, and a Codex that is not installed or not signed in throws
    // there. That would trap a user who runs custom endpoints only, because the last endpoint could
    // never be removed while an agent still names one of its models.
    const fallback =
      startingModel("opencode", remaining, this.#hooks.preference()) ??
      (this.#hooks.providerAvailable(DEFAULT_AGENT_PROVIDER)
        ? startingModel(DEFAULT_AGENT_PROVIDER, remaining, this.#hooks.preference())
        : null);
    // Nothing is listed, so there is no model to move to. The removal still goes ahead: refusing it
    // would trap the user on an endpoint that may be the reason no model is listed.
    if (!fallback) return;
    if (fallback.provider !== "opencode" && affected.some((agent) => this.#hasWorkInFlight(agent))) {
      throw new Error(sourceText("error.provider.endpointRemoveBusy"));
    }
    for (const agent of affected) {
      // Not the public `updateAgent`: this already runs inside the chain that one takes.
      await this.#hooks.applyAgentUpdate({
        agentId: agent.id,
        provider: fallback.provider,
        model: fallback.id,
        reasoningEffort: fallback.defaultReasoningEffort,
      });
    }
  }

  /**
   * Moves each agent of `provider` whose model the provider no longer lists to the provider's default,
   * or to the first model it lists when the default is gone too.
   *
   * Only called with a catalogue the provider has just reported, because a stale one is no proof that
   * a model is gone. The provider stays the same, so the agent keeps its thread, and a running turn
   * keeps the model it started with. An empty catalogue moves nobody: that is a provider with no
   * usable account, not a provider with no models.
   */
  async moveAgentsOffUnlistedModels(provider: AgentProvider): Promise<void> {
    const models = this.available().filter((model) => model.provider === provider);
    const fallback = models.find((model) => model.id === defaultProviderModel(provider)) ?? models[0];
    if (!fallback) return;
    const affected = this.#store
      .list()
      .filter((agent) => providerForAgent(agent) === provider && !models.some((model) => model.id === agent.model));
    for (const agent of affected) {
      try {
        await this.#hooks.applyAgentUpdate({
          agentId: agent.id,
          model: fallback.id,
          reasoningEffort: fallback.defaultReasoningEffort,
        });
      } catch (error) {
        this.#hooks.emitError("agent_model_fallback_failed", error, agent.id);
      }
    }
  }

  /**
   * Whether a turn is running for this agent or a delivery is still queued for it. Read from the
   * live snapshot first, then from the stored conversation, because an agent whose thread is not
   * loaded keeps its active turn in the database.
   */
  #hasWorkInFlight(agent: AgentSummary): boolean {
    if (this.#mailbox.hasUnfinishedDelivery(agent.id)) return true;
    const active =
      this.#conversation.workingSnapshot(agent.id)?.activeTurnId ??
      (agent.threadId ? this.#store.database.readConversation(agent.id, agent.threadId).activeTurnId : null);
    return Boolean(active);
  }
}
