import type { ClientSideConnection, SessionConfigOption } from "@agentclientprotocol/sdk";
import type {
  AgentSessionSettingOption,
  AgentSessionSettingsSnapshot,
  AgentSessionSettingValue,
} from "@openbot/contracts/ipc";
import { isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect, Fiber, type Scope, Semaphore } from "effect";
import type { AcpConnection } from "./acp-connection";
import type { AgentProvider } from "./agent-client";
import { isRecord } from "./protocol";
import {
  type ProviderClientOperationError,
  providerCall,
  providerFailure,
  providerSync,
} from "./provider-client-effects";
import { TimeoutError } from "./with-timeout";

const logger = createOpenBotLogger("provider-runtime");
/**
 * How long model discovery may spend on asking an agent for each model's reasoning efforts. One
 * OpenCode sweep of 49 models costs about 20ms, so this is not a target: it is the point where an
 * agent that answers slowly stops delaying the catalog the user is waiting for.
 */
const MODEL_REASONING_PROBE_BUDGET_MS = 5_000;

/**
 * How long one model's probe may take before the sweep goes on without it. An agent that stops
 * answering for one model then costs that model's efforts alone, and not the efforts of every model
 * after it in the catalog.
 */
const MODEL_REASONING_PROBE_TIMEOUT_MS = 1_000;

/**
 * What the sweep leaves of the discovery deadline for the request that follows it: the restore of the
 * model the session opened on. It is one round trip, and the catalog the caller waits for is already
 * built when it runs. The close of the probe session is not awaited and uses none of it.
 */
const MODEL_REASONING_CLEANUP_MS = 1_000;

/**
 * What discovery keeps of the caller's timeout to return with. Every request it makes ends by its own
 * deadline, which is this much before the timeout: a catalog that was read in time is worth returning,
 * and one that reaches the timeout is thrown away with the models already in it.
 */
const MODEL_DISCOVERY_RETURN_MS = 250;

export interface AcpModel {
  id: string;
  name: string;
  description: string;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: string[];
  /**
   * False when the agent offers no effort setting for the model: `supportedReasoningEfforts` is then
   * a placeholder, nothing is sent for it, and the agent decides the model's reasoning.
   */
  reasoningEffortConfigurable: boolean;
  reasoningEffortWireValues: Map<string, string>;
  usesModelReasoningEffort: boolean | null;
  /**
   * A model that OpenBot adds and the agent does not list. The agent takes it as the value of its
   * `model` option after each option in `config` has the value given there.
   */
  unlisted?: { config: Readonly<Record<string, string>> };
}

export interface AcpConfigurationState {
  id: string;
  configOptions: SessionConfigOption[];
  currentModelId: string | null;
  /** The session's own values of the options that an unlisted model changed, set back for a listed one. */
  unlistedOverrides?: Map<string, string>;
  /** The process of a session that has one of its own (`AcpFlavor.sessionProcesses`). */
  transport?: AcpConnection | null;
}
export interface AcpConfigurationOptions {
  connection(): ClientSideConnection;
  scope(): Scope.Scope;
  label(): string;
  provider: AgentProvider;
  requestTimeoutMs: number;
  discoveryCwd?: (() => string) | undefined;
  /** `AcpFlavor.processWideModel`. */
  processWideModel?: boolean;
  /**
   * `AcpFlavor.closeKeepsSession` with `session/resume`: a closed session keeps its resources until
   * the process ends, so each discovery resumes the probe session of the process, not a new one.
   */
  keepProbeSession?: () => boolean;
}

/** Owns ACP model discovery and setting translation. The client owns sessions and their state. */
export class AcpConfiguration {
  /** The model this agent process last took, for an agent whose model belongs to the process. */
  #processModel: { connection: ClientSideConnection; value: string } | null = null;
  /** Model sets sent and not answered. Sets that overlap can apply in an order their answers do not show. */
  #modelSetsInFlight = 0;
  #modelSetsOverlapped = false;
  /** A set that timed out or was interrupted can still apply later, so on this connection each set is sent. */
  #modelSetTimedOut: ClientSideConnection | null = null;
  /** The probe session that discovery resumes on this connection (`keepProbeSession`). */
  #probe: { connection: ClientSideConnection; sessionId: string } | null = null;
  /** One kept-probe discovery at a time: two at once would each open a probe, and one is kept. */
  readonly #probeLock = Semaphore.makeUnsafe(1);
  constructor(private readonly options: AcpConfigurationOptions) {}
  readonly discoverModels = Effect.fn("AcpConfiguration.discoverModels")(function* (
    this: AcpConfiguration,
    timeoutMs?: number,
  ): Effect.fn.Return<AcpModel[], ProviderClientOperationError> {
    const requestTimeoutMs = timeoutMs ?? this.options.requestTimeoutMs;
    const connection = yield* providerSync(() => this.options.connection());
    // One deadline for the whole discovery, read before the session opens and held short of the
    // caller's own timeout: what the sweep may spend is what a slow `session/new` left of the time
    // the caller gave `model/list`. A sweep that timed the caller out would return no catalog at all.
    const deadline = Date.now() + requestTimeoutMs - MODEL_DISCOVERY_RETURN_MS;
    const sweep = Effect.acquireUseRelease(
      this.#openProbe(connection),
      (probe) => this.#modelReasoningEffortsEffect(connection, probe, modelsFromSessionSetup(probe), deadline),
      (probe) =>
        this.options.keepProbeSession?.()
          ? Effect.sync(() => {
              this.#probe = { connection, sessionId: probe.sessionId };
            })
          : Effect.forkIn(
              providerCall(() => connection.closeSession({ sessionId: probe.sessionId })).pipe(Effect.ignore),
              this.options.scope(),
              { startImmediately: true },
            ).pipe(Effect.asVoid),
    );
    const discovery = yield* Effect.forkIn(
      this.options.keepProbeSession?.() ? this.#probeLock.withPermit(sweep) : sweep,
      this.options.scope(),
    );
    return yield* Fiber.join(discovery).pipe(
      Effect.timeoutOrElse({
        duration: requestTimeoutMs,
        orElse: () =>
          Effect.fail(
            providerFailure(
              new TimeoutError(
                sourceText("error.provider.acpModelsTimedOut", {
                  provider: this.options.label(),
                  seconds: String(Math.round(requestTimeoutMs / 1_000)),
                }),
              ),
            ),
          ),
      }),
    );
  });

  /** The process of the session when it has one of its own, otherwise the agent's. */
  #connection(thread: AcpConfigurationState): ClientSideConnection {
    return thread.transport ? thread.transport.requireConnection() : this.options.connection();
  }

  /** A new probe session, or the kept one resumed. A kept session that does not resume is replaced. */
  #openProbe(
    connection: ClientSideConnection,
  ): Effect.Effect<SessionSetupResponse & { sessionId: string }, ProviderClientOperationError> {
    const cwd = this.options.discoveryCwd?.() ?? process.cwd();
    const opened = providerCall(() => connection.newSession({ cwd, mcpServers: [] }));
    const kept = this.#probe?.connection === connection ? this.#probe.sessionId : null;
    if (!kept || !this.options.keepProbeSession?.()) return opened;
    this.#probe = null;
    // A resume that lists no models cannot give the catalog, so a new session gives it.
    return providerCall(() => connection.resumeSession({ sessionId: kept, cwd, mcpServers: [] })).pipe(
      Effect.flatMap((response) => {
        const probe = { ...response, sessionId: kept };
        return modelsFromSessionSetup(probe).length > 0 ? Effect.succeed(probe) : opened;
      }),
      Effect.catch(() => opened),
    );
  }

  /**
   * A discovery request that gives up at `until`, and reports any failure as `null`.
   *
   * The request is sent here, and not by the caller: after `until` there is nothing to send. A
   * request made anyway would still reach the agent and still change the session the sweep is about
   * to give back, and its own failure would have nobody left to read it.
   */

  readonly #requestBeforeEffect = Effect.fn("AcpConfiguration.requestBefore")(function* <T>(
    this: AcpConfiguration,
    request: () => Promise<T>,
    until: number,
    method: string,
  ): Effect.fn.Return<T | null, ProviderClientOperationError> {
    const remaining = until - Date.now();
    if (remaining <= 0) return null;
    return yield* providerCall(request).pipe(
      Effect.timeoutOrElse({
        duration: remaining,
        orElse: () =>
          Effect.fail(providerFailure(new TimeoutError(`${this.options.label()} request timed out: ${method}`))),
      }),
      Effect.catch(() => Effect.succeed(null)),
    );
  });

  /**
   * The reasoning efforts of each model, asked one model at a time on the session that listed them.
   *
   * An agent that holds reasoning in a session config option publishes `thought_level` for the model
   * the session is on, and a new session is on one model. Read as it arrives, every model of the
   * catalog carries that one model's efforts, and a model the session never selected carries no
   * efforts at all: OpenCode offers `minimal` to `xhigh` per model, and the Effort menu showed
   * `Medium` alone for all of them. Selecting the model on the same session makes the agent publish
   * the options of that model, so the catalog is built from one answer per model.
   *
   * Only for a catalog that came from the config option. An agent that describes each model's efforts
   * in `session/new` has answered already and is not asked again. An agent that groups its listed
   * models in the option (`groupedModelOption`) is asked: the list says nothing about efforts.
   *
   * No probe has to succeed. A model whose probe fails, or that the time does not reach, keeps the
   * session-wide efforts the catalog held before, and the user can still select them. `deadline` is when the caller's own `model/list`
   * times out: a sweep that ran past it would leave the user with no models at all, rather than with
   * imprecise efforts.
   */

  readonly #modelReasoningEffortsEffect = Effect.fn("AcpConfiguration.modelReasoningEfforts")(function* (
    this: AcpConfiguration,
    connection: ClientSideConnection,
    probe: SessionSetupResponse & { sessionId: string },
    models: AcpModel[],
    deadline: number,
  ): Effect.fn.Return<AcpModel[], ProviderClientOperationError> {
    const option = (probe.configOptions ?? []).find(
      (candidate): candidate is Extract<SessionConfigOption, { type: "select" }> =>
        candidate.category === "model" && candidate.type === "select",
    );
    const grouped = groupedModelOption(probe) !== null;
    if (!option || (availableModels(probe).length > 0 && !grouped)) return yield* providerSync(() => models);
    // A grouped option resolves a model to one of its efforts, so the session opened on the exact
    // model in the list, and goes back to it. The agent takes that model as a value too.
    const opening = grouped ? (listedCurrentModel(probe) ?? option.currentValue) : option.currentValue;
    // The sweep, and each request in it, ends at whichever comes first: its own budget, or the point
    // where the caller's deadline still holds the cleanup. One agent that never answers then costs
    // its own model's efforts, and not the whole catalog.
    const sweepEnd = Math.min(Date.now() + MODEL_REASONING_PROBE_BUDGET_MS, deadline - MODEL_REASONING_CLEANUP_MS);
    const startedAt = performance.now();
    const probed: AcpModel[] = [];
    let answered = 0;
    let selected = opening;
    // The sweep selects models on the process too, also while a turn sets its own.
    this.#processModel = null;
    for (const model of models) {
      const response = yield* this.#requestBeforeEffect(
        () => connection.setSessionConfigOption({ sessionId: probe.sessionId, configId: option.id, value: model.id }),
        Math.min(sweepEnd, Date.now() + MODEL_REASONING_PROBE_TIMEOUT_MS),
        "session/set_config_option",
      );
      if (response) {
        selected = model.id;
        answered += 1;
      }
      // An unanswered model holds the opening model's options, which say nothing about this model.
      probed.push(
        response
          ? { ...model, ...reasoningFromConfig(response.configOptions) }
          : { ...model, reasoningEffortConfigurable: true },
      );
    }
    // Back to the model the session opened on. The session is closed next, but an agent that keeps a
    // "last used model" outside the session would otherwise remember the end of this sweep, and the
    // user's own next CLI session would start on a model they never chose.
    if (selected !== opening) {
      yield* this.#requestBeforeEffect(
        () =>
          connection.setSessionConfigOption({
            sessionId: probe.sessionId,
            configId: option.id,
            value: opening,
          }),
        Math.min(Date.now() + MODEL_REASONING_CLEANUP_MS, deadline),
        "session/set_config_option",
      );
    }
    this.#processModel = null;
    logger.info("An agent reported the reasoning efforts of its models.", {
      provider: this.options.provider,
      models: models.length,
      probed: answered,
      withoutEffort: probed.filter((model) => !model.reasoningEffortConfigurable).length,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return yield* providerSync(() => probed);
  });

  readonly applyConfig = Effect.fn("AcpConfiguration.applyConfig")(function* (
    this: AcpConfiguration,
    thread: AcpConfigurationState,
    model: string | null,
    effort: string | null,
    models: AcpModel[],
  ): Effect.fn.Return<void, ProviderClientOperationError> {
    for (const [category, value] of [
      ["model", model],
      ["thought_level", effort],
    ] as const) {
      if (!value) continue;
      if (category === "thought_level" && thread.currentModelId) {
        const currentModel = models.find((candidate) => candidate.id === thread.currentModelId);
        if (currentModel && currentModel.usesModelReasoningEffort !== null) {
          if (currentModel.usesModelReasoningEffort && currentModel.supportedReasoningEfforts.includes(value)) {
            yield* this.#timed("session/set_model", () =>
              this.#connection(thread).request("session/set_model", {
                sessionId: thread.id,
                modelId: thread.currentModelId,
                _meta: { reasoningEffort: currentModel.reasoningEffortWireValues.get(value) ?? value },
              }),
            );
          }
          continue;
        }
      }
      const unlisted = category === "model" ? models.find((candidate) => candidate.id === value)?.unlisted : undefined;
      // A listed model after an unlisted one runs with the options the session had before: Cline's
      // `provider` goes back to the one whose models the session listed.
      if (category === "model" && !unlisted && thread.unlistedOverrides) {
        for (const [configId, original] of thread.unlistedOverrides) {
          const response = yield* this.#timed("session/set_config_option", () =>
            this.#connection(thread).setSessionConfigOption({ sessionId: thread.id, configId, value: original }),
          );
          thread.configOptions = response.configOptions;
        }
        delete thread.unlistedOverrides;
      }
      const options = thread.configOptions.filter(
        (candidate): candidate is Extract<SessionConfigOption, { type: "select" }> =>
          candidate.category === category && candidate.type === "select",
      );
      // Cline puts a provider option of the model category before its model option. The first option
      // of the category did not list the model, and the model was never sent. A model OpenBot added
      // goes to the agent's `model` option, which takes a value it did not list.
      const option =
        (category === "model" &&
          options.find((candidate) => selectValues(candidate).some((entry) => entry.value === value))) ||
        (unlisted && options.find((candidate) => candidate.id === "model")) ||
        options[0];
      if (!option) {
        if (category === "model" && thread.currentModelId !== value) {
          this.#processModel = null;
          yield* this.#timed("session/set_model", () =>
            this.#connection(thread).request("session/set_model", {
              sessionId: thread.id,
              modelId: value,
            }),
          );
          thread.currentModelId = value;
        }
        continue;
      }
      // An effort travels by OpenBot's name, and the agent's own name for it is read from the option
      // this session published, not from the catalog: the session is the one that has to accept it.
      const values = selectValues(option);
      const wanted =
        category === "thought_level" ? reasoningEffortWireValues(values.map((entry) => entry.value)).get(value) : value;
      const listed = values.some((candidate) => candidate.value === wanted);
      const selected = listed ? wanted : unlisted && option.id === "model" ? value : undefined;
      if (!selected) continue;
      for (const [configId, configValue] of listed ? [] : Object.entries(unlisted?.config ?? {})) {
        const required = thread.configOptions.find((candidate) => candidate.id === configId);
        if (required?.type !== "select" || required.currentValue === configValue) continue;
        thread.unlistedOverrides ??= new Map();
        if (!thread.unlistedOverrides.has(configId)) thread.unlistedOverrides.set(configId, required.currentValue);
        const response = yield* this.#timed("session/set_config_option", () =>
          this.#connection(thread).setSessionConfigOption({ sessionId: thread.id, configId, value: configValue }),
        );
        thread.configOptions = response.configOptions;
      }
      // The process runs every session on the model it took last, so the set is sent only for a change.
      // A new process is a new connection. A failed set, or one that another set overlapped, leaves
      // the model unknown.
      const connection = yield* providerSync(() => this.#connection(thread));
      const processWide = category === "model" && this.options.processWideModel === true;
      if (processWide) {
        if (this.#processModel?.connection === connection && this.#processModel.value === selected) {
          thread.currentModelId = selected;
          thread.configOptions = thread.configOptions.map((entry) =>
            entry === option ? { ...option, currentValue: selected } : entry,
          );
          continue;
        }
        this.#processModel = null;
        if (this.#modelSetsInFlight > 0) this.#modelSetsOverlapped = true;
        this.#modelSetsInFlight += 1;
      }
      const request = this.#timed("session/set_config_option", () =>
        connection.setSessionConfigOption({
          sessionId: thread.id,
          configId: option.id,
          value: selected,
        }),
      );
      const response = processWide
        ? yield* request.pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                if (!this.#modelSetsOverlapped && this.#modelSetTimedOut !== connection) {
                  this.#processModel = { connection, value: selected };
                }
              }),
            ),
            Effect.tapError((error) =>
              Effect.sync(() => {
                if (error.cause instanceof TimeoutError) this.#modelSetTimedOut = connection;
              }),
            ),
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                this.#modelSetTimedOut = connection;
              }),
            ),
            Effect.ensuring(
              Effect.sync(() => {
                this.#modelSetsInFlight -= 1;
                if (this.#modelSetsInFlight === 0) this.#modelSetsOverlapped = false;
              }),
            ),
          )
        : yield* request;
      thread.configOptions = response.configOptions;
      if (category === "model") thread.currentModelId = selected;
    }
  });

  readonly set = Effect.fn("AcpConfiguration.set")(function* (
    this: AcpConfiguration,
    thread: AcpConfigurationState,
    configId: string,
    value: AgentSessionSettingValue,
  ): Effect.fn.Return<AgentSessionSettingsSnapshot, ProviderClientOperationError> {
    const option = sessionSettingsSnapshot(thread.configOptions).options.find((entry) => entry.id === configId);
    if (!option) return yield* providerFailure(new Error(sourceText("error.provider.sessionSettingUnavailable")));
    if (
      option.type === "boolean"
        ? typeof value !== "boolean"
        : typeof value !== "string" || !option.options.some((choice) => choice.value === value)
    ) {
      return yield* providerFailure(new Error(sourceText("error.provider.sessionSettingInvalid")));
    }
    const response = yield* this.#timed("session/set_config_option", () =>
      typeof value === "boolean"
        ? this.#connection(thread).setSessionConfigOption({ sessionId: thread.id, configId, value, type: "boolean" })
        : this.#connection(thread).setSessionConfigOption({ sessionId: thread.id, configId, value }),
    );
    thread.configOptions = response.configOptions;
    return sessionSettingsSnapshot(thread.configOptions);
  });

  /**
   * A configuration request, which fails at the request timeout. A turn sends these before its
   * prompt, so without the limit a process that stopped answering held the turn with no end (#3520).
   */
  #timed<T>(method: string, request: () => Promise<T>): Effect.Effect<T, ProviderClientOperationError> {
    return providerCall(request).pipe(
      Effect.timeoutOrElse({
        duration: this.options.requestTimeoutMs,
        orElse: () =>
          Effect.fail(providerFailure(new TimeoutError(`${this.options.label()} request timed out: ${method}`))),
      }),
    );
  }
}

/** Permission and secret controls stay outside the generic settings path. */
function isAdditionalSetting(option: SessionConfigOption): boolean {
  const category = option.category?.toLowerCase();
  if (
    [category, option.id.toLowerCase()].some(
      (value) => value === "model" || value === "thought_level" || value === "mode",
    )
  )
    return false;
  const restricted = (text: string) => {
    const words = text.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ");
    return /(?:permission|approv|access|sandbox|security|credential|password|secret|token|api.?key|auth|bypass|unrestricted|yolo|trust|auto.?execut|allow.?all|\bmode\b)/i.test(
      words,
    );
  };
  if (restricted(`${option.id} ${option.name} ${option.description ?? ""} ${category ?? ""}`)) return false;
  if (option.type === "boolean") return true;
  return !option.options.some((entry) => {
    if ("options" in entry) {
      return (
        restricted(entry.name) ||
        entry.options.some((choice) => restricted(`${choice.value} ${choice.name} ${choice.description ?? ""}`))
      );
    }
    return restricted(`${entry.value} ${entry.name} ${entry.description ?? ""}`);
  });
}

export function sessionSettingsSnapshot(options: SessionConfigOption[]): AgentSessionSettingsSnapshot {
  return {
    options: options.filter(isAdditionalSetting).map((option): AgentSessionSettingOption => {
      const base = {
        id: option.id,
        name: option.name,
        ...(option.description == null ? {} : { description: option.description }),
        ...(option.category == null ? {} : { category: option.category }),
      };
      if (option.type === "boolean") return { ...base, type: "boolean", currentValue: option.currentValue };
      return {
        ...base,
        type: "select",
        currentValue: option.currentValue,
        options: option.options.flatMap((entry) => {
          const group = "options" in entry ? entry.name : undefined;
          const choices = "options" in entry ? entry.options : [entry];
          return choices.map((choice) => ({
            value: choice.value,
            name: choice.name,
            ...(choice.description == null ? {} : { description: choice.description }),
            ...(group === undefined ? {} : { group }),
          }));
        }),
      };
    }),
  };
}

interface SessionSetupResponse {
  configOptions?: SessionConfigOption[] | null;
  models?: unknown;
}

export function modelsFromSessionSetup(response: SessionSetupResponse): AcpModel[] {
  const options = sessionConfigOptions(response);
  const discovered = availableModels(response);
  if (discovered.length === 0 || groupedModelOption(response)) return modelsFromConfig(options);
  const configReasoning = reasoningFromConfig(options);
  return discovered.map((model) => {
    const supportedReasoningEfforts = model.supportedReasoningEfforts ?? configReasoning.supportedReasoningEfforts;
    const reasoningEffortWireValues = model.reasoningEffortWireValues;
    const defaultReasoningEffort =
      model.defaultReasoningEffort && supportedReasoningEfforts.includes(model.defaultReasoningEffort)
        ? model.defaultReasoningEffort
        : supportedReasoningEfforts.includes(configReasoning.defaultReasoningEffort)
          ? configReasoning.defaultReasoningEffort
          : (supportedReasoningEfforts[0] ?? "medium");
    return {
      id: model.id,
      name: model.name,
      description: model.description ?? "Model discovered from ACP CLI through ACP.",
      defaultReasoningEffort,
      supportedReasoningEfforts,
      reasoningEffortConfigurable:
        model.usesModelReasoningEffort ??
        (model.supportedReasoningEfforts ? true : configReasoning.reasoningEffortConfigurable),
      reasoningEffortWireValues:
        reasoningEffortWireValues && reasoningEffortWireValues.size > 0
          ? reasoningEffortWireValues
          : configReasoning.reasoningEffortWireValues,
      usesModelReasoningEffort: model.usesModelReasoningEffort,
    };
  });
}

function modelsFromConfig(options: SessionConfigOption[]): AcpModel[] {
  const model = options.find(
    (option): option is Extract<SessionConfigOption, { type: "select" }> =>
      option.category === "model" && option.type === "select",
  );
  if (!model) return [];
  const reasoning = reasoningFromConfig(options);
  return selectValues(model).map((option) => ({
    id: option.value,
    name: option.name,
    description: option.description ?? "Model discovered from ACP CLI through ACP.",
    ...reasoning,
    usesModelReasoningEffort: null,
  }));
}

function reasoningFromConfig(
  options: SessionConfigOption[],
): Pick<
  AcpModel,
  "defaultReasoningEffort" | "supportedReasoningEfforts" | "reasoningEffortConfigurable" | "reasoningEffortWireValues"
> {
  const thought = options.find((option) => option.category === "thought_level" && option.type === "select");
  const wireValues = reasoningEffortWireValues(
    thought && thought.type === "select" ? selectValues(thought).map((option) => option.value) : ["medium"],
  );
  const supported = [...wireValues.keys()];
  const currentEffort =
    thought && thought.type === "select" ? (normalizeEffort(thought.currentValue) ?? "medium") : "medium";
  return {
    defaultReasoningEffort: supported.includes(currentEffort) ? currentEffort : (supported[0] ?? "medium"),
    supportedReasoningEfforts: supported.length > 0 ? supported : ["medium"],
    // With no effort option, `medium` only keeps the catalog shape that older clients read. OpenCode
    // has none for Big Pickle, Kimi or MiMo, and the user reads "Medium" where the agent decides.
    reasoningEffortConfigurable: thought?.type === "select" && supported.length > 0,
    reasoningEffortWireValues: wireValues.size > 0 ? wireValues : new Map([["medium", "medium"]]),
  };
}

function sessionConfigOptions(response: SessionSetupResponse): SessionConfigOption[] {
  return response.configOptions ?? [];
}

export function currentModelFromSessionSetup(response: SessionSetupResponse): string | null {
  return groupedModelOption(response)?.currentValue ?? listedCurrentModel(response);
}

function listedCurrentModel(response: SessionSetupResponse): string | null {
  if (!isRecord(response.models)) return null;
  return isString(response.models.currentModelId) && response.models.currentModelId.trim()
    ? response.models.currentModelId.trim()
    : null;
}

/**
 * The model option of an agent that groups the models it lists in the superseded `models` field.
 *
 * Antigravity 1.3.0 and later list each reasoning effort as a model of its own there
 * (`gemini-3.1-pro-low`, `gemini-3.1-pro-high`), and offer the same models in the option as one
 * `gemini-3.1-pro` value with a `thought_level` option. Read from the list, every effort was a model
 * in the picker, the Effort menu offered the efforts a second time, and a model picked there was not
 * a value of the option, so the session never changed to it.
 *
 * Only when the agent has one model option, the option and the list differ, and the list says nothing
 * about efforts. An agent that lists the option's own models, describes each model's efforts, or has a
 * second model option (Cline has a provider option first) keeps the list.
 */
function groupedModelOption(response: SessionSetupResponse): Extract<SessionConfigOption, { type: "select" }> | null {
  const options = sessionConfigOptions(response).filter(
    (candidate): candidate is Extract<SessionConfigOption, { type: "select" }> =>
      candidate.category === "model" && candidate.type === "select",
  );
  const [option] = options;
  const listed = availableModels(response);
  if (options.length !== 1 || !option || listed.length === 0) return null;
  if (listed.some((model) => model.supportedReasoningEfforts || model.usesModelReasoningEffort !== null)) return null;
  const values = new Set(selectValues(option).map((entry) => entry.value));
  const ids = new Set(listed.map((model) => model.id));
  return values.size === ids.size && [...values].every((value) => ids.has(value)) ? null : option;
}

function availableModels(response: SessionSetupResponse): Array<{
  id: string;
  name: string;
  description: string | null;
  defaultReasoningEffort: string | null;
  supportedReasoningEfforts: string[] | null;
  reasoningEffortWireValues: Map<string, string> | null;
  usesModelReasoningEffort: boolean | null;
}> {
  if (!isRecord(response.models) || !Array.isArray(response.models.availableModels)) return [];
  const seen = new Set<string>();
  return response.models.availableModels.flatMap((value) => {
    if (!isRecord(value) || !isString(value.modelId) || !value.modelId.trim()) return [];
    const id = value.modelId.trim();
    if (seen.has(id)) return [];
    seen.add(id);
    const metadata = isRecord(value._meta) ? value._meta : null;
    const reasoningEffortValues = Array.isArray(metadata?.reasoningEfforts)
      ? metadata.reasoningEfforts.filter(isRecord).flatMap((effort) => (isString(effort.value) ? [effort.value] : []))
      : null;
    const wireValues = reasoningEffortValues ? reasoningEffortWireValues(reasoningEffortValues) : null;
    const supportedReasoningEfforts = wireValues ? [...wireValues.keys()] : null;
    const usesModelReasoningEffort =
      metadata?.supportsReasoningEffort === false
        ? false
        : metadata?.supportsReasoningEffort === true || (supportedReasoningEfforts?.length ?? 0) > 0
          ? true
          : null;
    return [
      {
        id,
        name: isString(value.name) && value.name.trim() ? value.name.trim() : id,
        description: isString(value.description) && value.description.trim() ? value.description.trim() : null,
        defaultReasoningEffort:
          metadata && isString(metadata.reasoningEffort) ? normalizeEffort(metadata.reasoningEffort) : null,
        supportedReasoningEfforts:
          metadata?.supportsReasoningEffort === false
            ? ["medium"]
            : supportedReasoningEfforts && supportedReasoningEfforts.length > 0
              ? supportedReasoningEfforts
              : null,
        reasoningEffortWireValues: wireValues,
        usesModelReasoningEffort,
      },
    ];
  });
}

function selectValues(option: Extract<SessionConfigOption, { type: "select" }>) {
  return option.options.flatMap((entry) => ("options" in entry ? entry.options : [entry]));
}

/**
 * What OpenBot's effort names are sent as, keyed by the OpenBot name.
 *
 * The exact name wins over an alias, whichever comes first. OpenCode offers
 * `["minimal", "low", "medium", "high", "xhigh"]`, where `minimal` also reads as low effort: first
 * value per key would make OpenBot's `low` send `minimal`, and a user who asks for low effort would
 * silently get the lowest one the model has. An alias is still kept for a key the agent has no exact
 * name for, which is how a model with `minimal` and no `low` stays reachable.
 */
function reasoningEffortWireValues(values: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const value of values) {
    const normalized = normalizeEffort(value);
    if (!normalized) continue;
    const held = result.get(normalized);
    // `value.toLowerCase()` and not the normalized form of it: an exact name is the agent's own
    // spelling of the key, and every key OpenBot has is one word.
    if (held === undefined || (held !== normalized && value.toLowerCase() === normalized)) {
      result.set(normalized, value);
    }
  }
  return result;
}

function normalizeEffort(value: string): string | null {
  const normalized = value.toLowerCase().replaceAll("-", "_");
  if (["low", "medium", "high", "xhigh", "max"].includes(normalized)) return normalized;
  if (["minimal", "none", "off"].includes(normalized)) return "low";
  // OpenCode offers MiniMax M3 `none` and `thinking` only. Without this the model listed `low`, which
  // turns thinking off, as its one effort.
  if (normalized === "thinking") return "high";
  if (["extra_high", "very_high"].includes(normalized)) return "xhigh";
  return null;
}
