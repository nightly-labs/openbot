import { type ClientSideConnection, RequestError, type SessionConfigOption } from "@agentclientprotocol/sdk";
import {
  type AgentSessionSettingOption,
  type AgentSessionSettingsSnapshot,
  type AgentSessionSettingValue,
  isReasoningEffort,
} from "@openbot/contracts/ipc";
import { isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect, Exit, Fiber, Schedule, type Scope, Semaphore } from "effect";
import type { AcpConnection } from "./acp-connection";
import { type AgentProvider, ProviderModelNotOfferedError } from "./agent-client";
import { isRecord } from "./protocol";
import {
  type ProviderClientOperationError,
  providerCall,
  providerFailure,
  providerSync,
} from "./provider-client-effects";
import { TimeoutError } from "./with-timeout";

const logger = createOpenBotLogger("provider-runtime");
const MODEL_REASONING_PROBE_BUDGET_MS = 5_000;

const MODEL_REASONING_PROBE_TIMEOUT_MS = 1_000;

const MODEL_REASONING_CLEANUP_MS = 1_000;

const MODEL_DISCOVERY_RETURN_MS = 250;

const PROBE_START_RETRY_MS = 1_000;

export interface AcpModel {
  id: string;
  name: string;
  description: string;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: string[];
  reasoningEffortConfigurable: boolean;
  reasoningEffortWireValues: Map<string, string>;
  usesModelReasoningEffort: boolean | null;
  unlisted?: { config: Readonly<Record<string, string>> };
}

export interface AcpConfigurationState {
  id: string;
  configOptions: SessionConfigOption[];
  currentModelId: string | null;
  unlistedOverrides?: Map<string, string>;
  transport?: AcpConnection | null;
}
export interface AcpConfigurationOptions {
  connection(): ClientSideConnection;
  scope(): Scope.Scope;
  label(): string;
  provider: AgentProvider;
  requestTimeoutMs: number;
  discoveryCwd?: (() => string) | undefined;
  processWideModel?: boolean;
  setsConfigOnlyOnChange?: boolean;
  modelSetUnsaved?: ((error: RequestError) => boolean) | undefined;
  modelConfigId?: string | undefined;
  configSetUnsaved?: ((error: RequestError) => boolean) | undefined;
  keepProbeSession?: () => boolean;
  probeCloseDelayMs?: number | undefined;
  effortCategories?: readonly string[] | undefined;
  deletesSessions?: () => boolean;
  stillStarting?: ((error: unknown) => boolean) | undefined;
}

const EFFORT_CATEGORIES: readonly string[] = ["thought_level"];

function isEffortOption(option: SessionConfigOption, categories: readonly string[]): boolean {
  if (option.type !== "select" || option.category == null || !categories.includes(option.category)) return false;
  return (
    option.category === "thought_level" || selectValues(option).every((entry) => normalizeEffort(entry.value) !== null)
  );
}

export class AcpConfiguration {
  #processModel: { connection: ClientSideConnection; value: string } | null = null;
  #modelSetsInFlight = 0;
  #modelSetsOverlapped = false;
  #modelSetTimedOut: ClientSideConnection | null = null;
  readonly #unconfirmedSets = new WeakMap<AcpConfigurationState, Set<string>>();
  #probe: { connection: ClientSideConnection; sessionId: string } | null = null;
  readonly #probeLock = Semaphore.makeUnsafe(1);
  #answeredEfforts: {
    connection: ClientSideConnection;
    models: Map<string, ReturnType<typeof reasoningFromConfig>>;
  } | null = null;
  readonly #effortCategories: readonly string[];
  constructor(private readonly options: AcpConfigurationOptions) {
    this.#effortCategories = options.effortCategories ?? EFFORT_CATEGORIES;
  }

  sessionSettings(options: SessionConfigOption[]): AgentSessionSettingsSnapshot {
    return sessionSettingsSnapshot(options, this.#effortCategories);
  }
  readonly discoverModels = Effect.fn("AcpConfiguration.discoverModels")(function* (
    this: AcpConfiguration,
    timeoutMs?: number,
  ): Effect.fn.Return<AcpModel[], ProviderClientOperationError> {
    const requestTimeoutMs = timeoutMs ?? this.options.requestTimeoutMs;
    const connection = yield* providerSync(() => this.options.connection());
    const deadline = Date.now() + requestTimeoutMs - MODEL_DISCOVERY_RETURN_MS;
    const sweep = Effect.acquireUseRelease(
      this.#openProbe(connection, deadline),
      (probe) =>
        this.#modelReasoningEffortsEffect(
          connection,
          probe,
          modelsFromSessionSetup(probe, this.#effortCategories),
          deadline,
        ),
      (probe) =>
        this.options.keepProbeSession?.()
          ? Effect.sync(() => {
              this.#probe = { connection, sessionId: probe.sessionId };
            })
          : Effect.forkIn(
              closeLater(this.#releaseProbe(connection, probe.sessionId), this.options.probeCloseDelayMs),
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

  #connection(thread: AcpConfigurationState): ClientSideConnection {
    return thread.transport ? thread.transport.requireConnection() : this.options.connection();
  }

  #releaseProbe(connection: ClientSideConnection, sessionId: string): Effect.Effect<void> {
    const close = providerCall(() => connection.closeSession({ sessionId })).pipe(Effect.ignore);
    if (!this.options.deletesSessions?.()) return close;
    return providerCall(() => connection.deleteSession({ sessionId })).pipe(
      Effect.asVoid,
      Effect.catch(() => close),
    );
  }

  #openProbe(
    connection: ClientSideConnection,
    deadline: number,
  ): Effect.Effect<SessionSetupResponse & { sessionId: string }, ProviderClientOperationError> {
    const cwd = this.options.discoveryCwd?.() ?? process.cwd();
    const stillStarting = this.options.stillStarting;
    const opened = Effect.suspend(() => {
      let attemptStartedAt = 0;
      let longestAttemptMs = 0;
      return Effect.suspend(() => {
        attemptStartedAt = Date.now();
        return providerCall(() => connection.newSession({ cwd, mcpServers: [] }));
      }).pipe(
        Effect.retry({
          while: (failure) => {
            const now = Date.now();
            longestAttemptMs = Math.max(longestAttemptMs, now - attemptStartedAt);
            return stillStarting?.(failure.cause) === true && now + longestAttemptMs + PROBE_START_RETRY_MS < deadline;
          },
          schedule: Schedule.spaced(PROBE_START_RETRY_MS),
        }),
      );
    });
    const kept = this.#probe?.connection === connection ? this.#probe.sessionId : null;
    if (!kept || !this.options.keepProbeSession?.()) return opened;
    this.#probe = null;
    return providerCall(() => connection.resumeSession({ sessionId: kept, cwd, mcpServers: [] })).pipe(
      Effect.flatMap((response) => {
        const probe = { ...response, sessionId: kept };
        return modelsFromSessionSetup(probe).length > 0 ? Effect.succeed(probe) : opened;
      }),
      Effect.catch(() => opened),
    );
  }

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
    const listed = availableModels(probe).length > 0 && !grouped;
    const withoutEfforts =
      !!option && listed && !this.options.processWideModel && listsModelsWithoutEfforts(probe, option);
    if (!option || (listed && !withoutEfforts)) return yield* providerSync(() => models);
    const opening = grouped ? (listedCurrentModel(probe) ?? option.currentValue) : option.currentValue;
    const sweepEnd = Math.min(Date.now() + MODEL_REASONING_PROBE_BUDGET_MS, deadline - MODEL_REASONING_CLEANUP_MS);
    const startedAt = performance.now();
    const probed: AcpModel[] = [];
    let answered = 0;
    let selected = opening;
    if (this.#answeredEfforts?.connection !== connection) this.#answeredEfforts = { connection, models: new Map() };
    const answeredEfforts = this.#answeredEfforts.models;
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
      const efforts = response
        ? reasoningFromConfig(response.configOptions, this.#effortCategories)
        : answeredEfforts.get(model.id);
      if (response && efforts) answeredEfforts.set(model.id, efforts);
      probed.push(
        efforts ? { ...model, ...efforts } : withoutEfforts ? model : { ...model, reasoningEffortConfigurable: true },
      );
    }
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
    requireModel = false,
  ): Effect.fn.Return<void, ProviderClientOperationError> {
    for (const [category, value] of [
      ["model", model],
      ["thought_level", effort],
    ] as const) {
      if (!value) continue;
      if (category === "thought_level" && thread.currentModelId) {
        const currentModel = models.find((candidate) => candidate.id === thread.currentModelId);
        if (currentModel && currentModel.usesModelReasoningEffort !== null) {
          const effort = listedEffort(value, (level) => currentModel.supportedReasoningEfforts.includes(level));
          if (currentModel.usesModelReasoningEffort && effort) {
            yield* this.#timed("session/set_model", () =>
              this.#connection(thread).request("session/set_model", {
                sessionId: thread.id,
                modelId: thread.currentModelId,
                _meta: { reasoningEffort: currentModel.reasoningEffortWireValues.get(effort) ?? effort },
              }),
            );
          }
          continue;
        }
      }
      const unlisted = category === "model" ? models.find((candidate) => candidate.id === value)?.unlisted : undefined;
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
          category === "thought_level"
            ? isEffortOption(candidate, this.#effortCategories)
            : candidate.category === category && candidate.type === "select",
      );
      const option =
        (category === "model" &&
          options.find((candidate) => selectValues(candidate).some((entry) => entry.value === value))) ||
        (unlisted && options.find((candidate) => candidate.id === "model")) ||
        options[0];
      const modelConfigId = category === "model" ? this.options.modelConfigId : undefined;
      if (modelConfigId) {
        const configId = option?.id ?? modelConfigId;
        if ((option?.currentValue ?? thread.currentModelId) !== value) {
          const response = yield* this.#setConfigOption(thread, configId, value, () =>
            this.#connection(thread).setSessionConfigOption({ sessionId: thread.id, configId, value }),
          );
          thread.configOptions = response.configOptions;
        }
        thread.currentModelId = value;
        continue;
      }
      if (!option) {
        if (category === "model" && thread.currentModelId !== value) {
          this.#processModel = null;
          yield* this.#timed("session/set_model", () =>
            this.#connection(thread).request("session/set_model", {
              sessionId: thread.id,
              modelId: value,
            }),
          ).pipe(
            Effect.catch((failure) => {
              const unsaved = this.options.modelSetUnsaved;
              if (!(failure.cause instanceof RequestError && unsaved?.(failure.cause))) return Effect.fail(failure);
              logger.warn("An agent changed the session model but did not save it as its default.", {
                provider: this.options.provider,
              });
              return Effect.void;
            }),
          );
          thread.currentModelId = value;
        }
        continue;
      }
      const values = selectValues(option);
      const wanted = category === "thought_level" ? effortWireValue(values, value) : value;
      const listed = values.some((candidate) => candidate.value === wanted);
      const selected = listed ? wanted : unlisted && option.id === "model" ? value : undefined;
      if (!selected) {
        if (
          category === "model" &&
          requireModel &&
          !values.some(
            (candidate) =>
              value.startsWith(`${candidate.value}-`) && isReasoningEffort(value.slice(candidate.value.length + 1)),
          )
        ) {
          logger.warn("An agent session does not offer the model of the turn.", {
            provider: this.options.provider,
            model: value,
          });
          const name = models.find((candidate) => candidate.id === value)?.name ?? value;
          return yield* providerFailure(new ProviderModelNotOfferedError(this.options.label(), name));
        }
        continue;
      }
      if (
        this.options.setsConfigOnlyOnChange &&
        listed &&
        option.currentValue === selected &&
        !this.#unconfirmedSets.get(thread)?.has(option.id)
      ) {
        if (category === "model") thread.currentModelId = selected;
        continue;
      }
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
      const request = this.#setConfigOption(thread, option.id, selected, () =>
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
        : yield* this.#confirmingSet(thread, option.id, request);
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
    const option = this.sessionSettings(thread.configOptions).options.find((entry) => entry.id === configId);
    if (!option) return yield* providerFailure(new Error(sourceText("error.provider.sessionSettingUnavailable")));
    if (
      option.type === "boolean"
        ? typeof value !== "boolean"
        : typeof value !== "string" || !option.options.some((choice) => choice.value === value)
    ) {
      return yield* providerFailure(new Error(sourceText("error.provider.sessionSettingInvalid")));
    }
    const response = yield* this.#setConfigOption(thread, configId, value, () =>
      typeof value === "boolean"
        ? this.#connection(thread).setSessionConfigOption({ sessionId: thread.id, configId, value, type: "boolean" })
        : this.#connection(thread).setSessionConfigOption({ sessionId: thread.id, configId, value }),
    );
    thread.configOptions = response.configOptions;
    return this.sessionSettings(thread.configOptions);
  });

  #confirmingSet<A, E>(thread: AcpConfigurationState, configId: string, set: Effect.Effect<A, E>): Effect.Effect<A, E> {
    if (!this.options.setsConfigOnlyOnChange) return set;
    return set.pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => {
          const unconfirmed = this.#unconfirmedSets.get(thread) ?? new Set<string>();
          if (Exit.isSuccess(exit)) unconfirmed.delete(configId);
          else unconfirmed.add(configId);
          this.#unconfirmedSets.set(thread, unconfirmed);
        }),
      ),
    );
  }

  #setConfigOption(
    thread: AcpConfigurationState,
    configId: string,
    value: AgentSessionSettingValue,
    request: () => Promise<{ configOptions: SessionConfigOption[] }>,
  ): Effect.Effect<{ configOptions: SessionConfigOption[] }, ProviderClientOperationError> {
    return this.#timed("session/set_config_option", request).pipe(
      Effect.catch((failure) => {
        const unsaved = this.options.configSetUnsaved;
        if (!(failure.cause instanceof RequestError && unsaved?.(failure.cause))) return Effect.fail(failure);
        logger.warn("An agent changed a session setting but did not save it as its default.", {
          provider: this.options.provider,
          configId,
        });
        return Effect.succeed({ configOptions: withCurrentValue(thread.configOptions, configId, value) });
      }),
    );
  }

  #timed<T>(method: string, request: () => Promise<T>): Effect.Effect<T, ProviderClientOperationError> {
    return providerCall(request).pipe(
      Effect.timeoutOrElse({
        duration: this.options.requestTimeoutMs,
        orElse: () => {
          logger.warn("An agent did not answer a configuration request in time.", {
            provider: this.options.provider,
            method,
          });
          const message = sourceText("error.provider.acpSettingsTimedOut", { provider: this.options.label() });
          return Effect.fail(providerFailure(new TimeoutError(message)));
        },
      }),
    );
  }
}

function closeLater<A, E>(close: Effect.Effect<A, E>, delayMs: number | undefined): Effect.Effect<A, E> {
  return delayMs ? Effect.sleep(delayMs).pipe(Effect.andThen(close)) : close;
}

function withCurrentValue(
  options: readonly SessionConfigOption[],
  configId: string,
  value: AgentSessionSettingValue,
): SessionConfigOption[] {
  return options.map((option) => {
    if (option.id !== configId) return option;
    if (option.type === "boolean") return typeof value === "boolean" ? { ...option, currentValue: value } : option;
    return typeof value === "string" ? { ...option, currentValue: value } : option;
  });
}

function isAdditionalSetting(option: SessionConfigOption, effortCategories: readonly string[]): boolean {
  if (isEffortOption(option, effortCategories)) return false;
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

function sessionSettingsSnapshot(
  options: SessionConfigOption[],
  effortCategories: readonly string[],
): AgentSessionSettingsSnapshot {
  const additional = (option: SessionConfigOption) => isAdditionalSetting(option, effortCategories);
  return {
    options: options.filter(additional).map((option): AgentSessionSettingOption => {
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

export function modelsFromSessionSetup(
  response: SessionSetupResponse,
  effortCategories: readonly string[] = EFFORT_CATEGORIES,
): AcpModel[] {
  const options = sessionConfigOptions(response);
  const discovered = availableModels(response);
  if (discovered.length === 0 || groupedModelOption(response)) return modelsFromConfig(options, effortCategories);
  const configReasoning = reasoningFromConfig(options, effortCategories);
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

function modelsFromConfig(options: SessionConfigOption[], effortCategories: readonly string[]): AcpModel[] {
  const model = options.find(
    (option): option is Extract<SessionConfigOption, { type: "select" }> =>
      option.category === "model" && option.type === "select",
  );
  if (!model) return [];
  const reasoning = reasoningFromConfig(options, effortCategories);
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
  effortCategories: readonly string[],
): Pick<
  AcpModel,
  "defaultReasoningEffort" | "supportedReasoningEfforts" | "reasoningEffortConfigurable" | "reasoningEffortWireValues"
> {
  const thought = options.find((option) => isEffortOption(option, effortCategories));
  const wireValues = reasoningEffortWireValues(
    thought && thought.type === "select" ? selectValues(thought).map((option) => option.value) : ["medium"],
  );
  const supported = [...wireValues.keys()];
  const currentEffort =
    thought && thought.type === "select" ? (normalizeEffort(thought.currentValue) ?? "medium") : "medium";
  return {
    defaultReasoningEffort: supported.includes(currentEffort) ? currentEffort : (supported[0] ?? "medium"),
    supportedReasoningEfforts: supported.length > 0 ? supported : ["medium"],
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

function listsModelsWithoutEfforts(
  response: SessionSetupResponse,
  option: Extract<SessionConfigOption, { type: "select" }>,
): boolean {
  const listed = availableModels(response);
  if (listed.some((model) => model.supportedReasoningEfforts || model.usesModelReasoningEffort !== null)) return false;
  const efforts = (candidate: SessionConfigOption) =>
    candidate.category === "thought_level" && candidate.type === "select";
  if (sessionConfigOptions(response).some(efforts)) return false;
  const values = new Set(selectValues(option).map((entry) => entry.value));
  return listed.every((model) => values.has(model.id));
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

function reasoningEffortWireValues(values: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const value of values) {
    const normalized = normalizeEffort(value);
    if (!normalized) continue;
    const held = result.get(normalized);
    if (held === undefined || (held !== normalized && value.toLowerCase() === normalized)) {
      result.set(normalized, value);
    }
  }
  return result;
}

function effortWireValue(values: { value: string }[], effort: string): string | undefined {
  const wireValues = reasoningEffortWireValues(values.map((entry) => entry.value));
  const listed = listedEffort(effort, (level) => wireValues.has(level));
  return listed ? wireValues.get(listed) : undefined;
}

function listedEffort(effort: string, listed: (level: string) => boolean): string | undefined {
  if (listed(effort)) return effort;
  return effort === "low" ? ["minimal", "none"].find(listed) : undefined;
}

function normalizeEffort(value: string): string | null {
  const normalized = value.toLowerCase().replaceAll("-", "_");
  if (isReasoningEffort(normalized)) return normalized;
  if (normalized === "off") return "none";
  if (normalized === "thinking" || normalized === "on") return "high";
  if (["extra_high", "very_high"].includes(normalized)) return "xhigh";
  return null;
}
