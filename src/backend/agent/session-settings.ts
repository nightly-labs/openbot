import { customAgentIdOfModel } from "@openbot/contracts/agent-providers";
import type {
  AgentSessionSettings,
  AgentSessionSettingsSnapshot,
  AgentSessionSettingValue,
  AgentSummary,
  ResetAgentSessionSettingInput,
  SetAgentSessionSettingInput,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Schema } from "effect";
import type { AgentClient } from "../agent-client";
import type { AgentStore } from "../agent-store";
import type { DrainScheduler } from "./drain-scheduler";
import type { ProviderRuntime } from "./provider-runtime";
import type { ThreadLifecycle } from "./thread-lifecycle";

export function sessionSettingsIdentity(agent: AgentSummary): string {
  return agent.provider === "acp" ? `acp:${customAgentIdOfModel(agent.model) ?? ""}` : agent.provider;
}

export function sessionSettingsOverrides(agent: AgentSummary): Record<string, AgentSessionSettingValue> {
  return agent.sessionSettingOverrides?.[sessionSettingsIdentity(agent)] ?? {};
}

export class SessionSettingsFailed extends Schema.TaggedError<SessionSettingsFailed>()("SessionSettingsFailed", {
  cause: Schema.Defect(),
}) {}
const settingsStep = <A>(run: () => A) =>
  Effect.try({ try: run, catch: (cause) => new SessionSettingsFailed({ cause }) });
const settingsFailure = (key: "error.provider.sessionSettingUnavailable" | "error.provider.sessionSettingInvalid") =>
  new SessionSettingsFailed({ cause: new Error(sourceText(key)) });

export interface SessionSettingsOptions {
  store: AgentStore;
  providers: ProviderRuntime;
  threads: ThreadLifecycle;
  drain: DrainScheduler;
  busy(agentId: string): boolean;
  changed(agentId: string): void;
  exclusive<A>(run: () => Effect.Effect<A, SessionSettingsFailed>): Effect.Effect<A, SessionSettingsFailed>;
}

/** Owns saved session settings and their application. Provider clients own effective option values. */
export class SessionSettings {
  constructor(private readonly options: SessionSettingsOptions) {}

  #agent(agentId: string): AgentSummary {
    const agent = this.options.store.list().find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error(sourceText("error.agent.selectedGone"));
    return agent;
  }

  /** The caller serializes this operation with profile and provider changes. */
  readonly read = Effect.fn("SessionSettings.read")(function* (this: SessionSettings, agentId: string) {
    return yield* this.#withHold(agentId, this.#read(agentId));
  });

  readonly set = Effect.fn("SessionSettings.set")(function* (
    this: SessionSettings,
    input: SetAgentSessionSettingInput,
  ) {
    return yield* this.#withHold(
      input.agentId,
      Effect.gen({ self: this }, function* () {
        const current = yield* this.#read(input.agentId);
        const option = current.options.find((candidate) => candidate.id === input.settingId);
        if (!option) return yield* settingsFailure("error.provider.sessionSettingUnavailable");
        if (
          option.type === "boolean"
            ? typeof input.value !== "boolean"
            : typeof input.value !== "string" || !option.options.some((choice) => choice.value === input.value)
        )
          return yield* settingsFailure("error.provider.sessionSettingInvalid");
        yield* this.#save(input.agentId, input.settingId, input.value);
        return yield* this.#read(input.agentId, input.settingId);
      }),
    );
  });

  readonly reset = Effect.fn("SessionSettings.reset")(function* (
    this: SessionSettings,
    input: ResetAgentSessionSettingInput,
  ) {
    return yield* this.#withHold(
      input.agentId,
      Effect.gen({ self: this }, function* () {
        yield* this.#save(input.agentId, input.settingId, undefined);
        return yield* this.#read(input.agentId);
      }),
    );
  });

  readonly #withHold = Effect.fn("SessionSettings.withHold")(function* <A>(
    this: SessionSettings,
    agentId: string,
    operation: Effect.Effect<A, SessionSettingsFailed>,
  ) {
    return yield* Effect.acquireUseRelease(
      Effect.sync(() => this.options.drain.holdSessionSettings(agentId)),
      () =>
        Effect.gen({ self: this }, function* () {
          yield* this.options.drain.taskFor(agentId)?.pipe(Effect.ignore) ?? Effect.void;
          const agent = yield* settingsStep(() => this.#agent(agentId));
          if (!this.options.busy(agentId) && !this.options.threads.providerContextBusy(agent)) {
            yield* this.options.providers
              .ensureAgentClient(agent)
              .pipe(Effect.mapError((failure) => new SessionSettingsFailed({ cause: failure.cause })));
          }
          return yield* this.options.exclusive(() => operation);
        }),
      (release) => Effect.sync(release),
    );
  });

  readonly #save = Effect.fn("SessionSettings.save")(function* (
    this: SessionSettings,
    agentId: string,
    settingId: string,
    value: AgentSessionSettingValue | undefined,
  ) {
    yield* settingsStep(() => {
      const agent = this.#agent(agentId);
      const identity = sessionSettingsIdentity(agent);
      const overrides = structuredClone(agent.sessionSettingOverrides ?? {});
      const values = { ...overrides[identity] };
      if (value === undefined) delete values[settingId];
      else values[settingId] = value;
      if (Object.keys(values).length === 0) delete overrides[identity];
      else overrides[identity] = values;
      this.options.store.setSessionSettingOverrides(agentId, overrides, value === undefined ? identity : undefined);
      this.options.changed(agentId);
    });
    if (value === undefined) yield* this.options.threads.refreshAgentRuntime(agentId);
  });

  readonly #read = Effect.fn("SessionSettings.snapshot")(function* (
    this: SessionSettings,
    agentId: string,
    applySettingId?: string,
  ): Effect.fn.Return<AgentSessionSettings, SessionSettingsFailed> {
    const agent = yield* settingsStep(() => this.#agent(agentId));
    const busy = this.options.busy(agentId) || this.options.threads.providerContextBusy(agent);
    const overrides = sessionSettingsOverrides(agent);
    let client: AgentClient | null;
    let threadId: string | undefined;
    if (busy) {
      client = this.options.providers.clientForAgent(agent);
      threadId = agent.threadId
        ? this.options.store.database.activeProviderSession(agent.threadId, agent.provider)?.externalSessionId
        : undefined;
    } else {
      yield* this.options.threads.applyPendingRuntimeRefresh(agent);
      client = yield* settingsStep(() => this.options.providers.requireReadyClientForAgent(agent));
      if (client.readSessionSettings)
        threadId = yield* this.options.threads
          .ensureThread(agent, client)
          .pipe(Effect.mapError((failure) => new SessionSettingsFailed({ cause: failure.cause })));
    }
    let snapshot: AgentSessionSettingsSnapshot = { options: [] };
    if (threadId && client?.readSessionSettings) {
      snapshot = yield* client
        .readSessionSettings(threadId)
        .pipe(Effect.mapError((failure) => new SessionSettingsFailed({ cause: failure.cause })));
      // Notification reads report provider state. Only an explicit edit writes here;
      // saved overrides are also applied by the ACP client before the next turn.
      if (!busy && applySettingId !== undefined && client.setSessionSetting) {
        for (const [id, value] of Object.entries(overrides)) {
          if (id !== applySettingId) continue;
          const option = snapshot.options.find((candidate) => candidate.id === id);
          const valid =
            option?.type === "boolean"
              ? typeof value === "boolean"
              : option?.type === "select" &&
                typeof value === "string" &&
                option.options.some((choice) => choice.value === value);
          if (!valid || option?.currentValue === value) continue;
          snapshot = yield* client
            .setSessionSetting(threadId, id, value)
            .pipe(Effect.mapError((failure) => new SessionSettingsFailed({ cause: failure.cause })));
        }
      }
    }
    const pending = Object.entries(overrides).some(
      ([id, value]) => snapshot.options.find((option) => option.id === id)?.currentValue !== value,
    );
    return {
      agentId,
      providerIdentity: sessionSettingsIdentity(agent),
      overrides,
      pending:
        pending ||
        this.options.threads.runtimeRefreshPending(agentId) ||
        Boolean(agent.sessionSettingResets?.includes(sessionSettingsIdentity(agent))),
      ...snapshot,
    };
  });
}
