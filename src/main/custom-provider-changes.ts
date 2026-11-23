import {
  type CustomProviderHarness,
  type CustomProviderRestart,
  type CustomProviderResult,
  type CustomProviderSummary,
  DEFAULT_CUSTOM_PROVIDER_HARNESS,
  type SaveCustomProviderInput,
  type UpdateCustomProviderInput,
} from "@openbot/contracts/ipc";
import { Effect, Semaphore } from "effect";
import { AgentLifecycleFailed, type AgentService } from "../backend/agent-service";
import type { CustomProviderStore } from "./custom-provider-store";
import { type ProviderRuntimeFailure, runtimeSync, toProviderRuntimeFailure } from "./provider-runtime-effects";
import type { ProviderRuntimeManager } from "./provider-runtime-manager";

export interface CustomProviderChangeDependencies {
  service: Pick<
    AgentService,
    | "saveCustomProvider"
    | "updateCustomProvider"
    | "removeCustomProvider"
    | "reloadCustomProviderConfig"
    | "startHarnessForMovedAgents"
  >;
  customProviders: Pick<CustomProviderStore, "list" | "save" | "checkUpdate" | "update" | "remove">;
  providerRuntimes: Pick<ProviderRuntimeManager, "startCustomProviderHarness">;
  refreshModelReasoning?: () => Effect.Effect<boolean>;
}

export interface CustomProviderChanges {
  list(): CustomProviderSummary[];
  save(input: SaveCustomProviderInput): Effect.Effect<CustomProviderResult, ProviderRuntimeFailure>;
  update(input: UpdateCustomProviderInput): Effect.Effect<CustomProviderResult, ProviderRuntimeFailure>;
  peerUpdate(input: UpdateCustomProviderInput): Effect.Effect<CustomProviderResult, ProviderRuntimeFailure>;
  peerHarnessUpdate(
    input: UpdateCustomProviderInput,
    harness: CustomProviderHarness,
  ): Effect.Effect<CustomProviderResult, ProviderRuntimeFailure>;
  remove(id: string): Effect.Effect<CustomProviderResult, ProviderRuntimeFailure>;
}

export function createCustomProviderChanges({
  service,
  customProviders,
  providerRuntimes,
  refreshModelReasoning,
}: CustomProviderChangeDependencies): CustomProviderChanges {
  const gate = Semaphore.makeUnsafe(1);
  const harnessOf = (id: string) => customProviders.list().find((provider) => provider.id === id)?.harness;
  const restart = Effect.fn("CustomProviderChanges.restart")(function* (
    current: CustomProviderHarness | undefined,
    previous: CustomProviderHarness | undefined,
  ) {
    const now = current ?? DEFAULT_CUSTOM_PROVIDER_HARNESS;
    const outcome: CustomProviderRestart = yield* service.reloadCustomProviderConfig(now);
    if (previous === undefined || previous === now) return outcome;
    const before = yield* service.reloadCustomProviderConfig(previous);
    if (outcome !== "skipped-busy") yield* service.startHarnessForMovedAgents(now);
    return before === "skipped-busy" ? before : outcome;
  });
  const serve = Effect.fn("CustomProviderChanges.serve")(function* (
    id: string,
    previous: CustomProviderHarness | undefined,
  ) {
    const current = harnessOf(id);
    const reasoningChanged = refreshModelReasoning ? yield* refreshModelReasoning() : false;
    const outcome = yield* restart(current, previous);
    if (reasoningChanged && (current ?? DEFAULT_CUSTOM_PROVIDER_HARNESS) !== "opencode" && previous !== "opencode")
      yield* service.reloadCustomProviderConfig("opencode");
    yield* providerRuntimes.startCustomProviderHarness(current ?? DEFAULT_CUSTOM_PROVIDER_HARNESS);
    return outcome;
  });
  function serialize<T>(run: () => Effect.Effect<T, ProviderRuntimeFailure>): Effect.Effect<T, ProviderRuntimeFailure> {
    return gate.withPermit(Effect.suspend(run));
  }

  const update = (input: UpdateCustomProviderInput) =>
    Effect.fn("CustomProviderChanges.update")(function* () {
      yield* runtimeSync(() => customProviders.checkUpdate(input));
      const saved = customProviders.list().find((provider) => provider.id === input.id);
      const previous = saved?.harness;
      const kept = new Set(input.models.map((model) => model.id));
      const removed = (saved?.models ?? []).filter((model) => !kept.has(model.id)).map((model) => model.id);
      const providers = yield* service
        .updateCustomProvider(input.id, input.harness ?? previous ?? DEFAULT_CUSTOM_PROVIDER_HARNESS, removed, () =>
          customProviders
            .update(input)
            .pipe(
              Effect.mapError(
                (error) => new AgentLifecycleFailed({ operation: "updateCustomProvider", cause: error.cause }),
              ),
            ),
        )
        .pipe(toProviderRuntimeFailure);
      return {
        providers,
        restart: yield* serve(input.id, previous).pipe(toProviderRuntimeFailure),
      };
    })().pipe(Effect.uninterruptible);
  const withSavedModelSettings = (input: UpdateCustomProviderInput): UpdateCustomProviderInput => {
    const saved = new Map(
      (customProviders.list().find((provider) => provider.id === input.id)?.models ?? []).map((model) => [
        model.id,
        model,
      ]),
    );
    return {
      id: input.id,
      name: input.name,
      baseUrl: input.baseUrl,
      models: input.models.map((model) => ({ ...saved.get(model.id), id: model.id, name: model.name })),
      ...(input.apiKey !== undefined ? { apiKey: input.apiKey } : {}),
      ...(input.headers !== undefined ? { headers: input.headers } : {}),
    };
  };

  return {
    list: () => customProviders.list(),
    save: (input) =>
      serialize(() =>
        Effect.fn("CustomProviderChanges.save")(function* () {
          const previous = harnessOf(input.id);
          const providers = yield* service
            .saveCustomProvider(input.id, input.harness ?? DEFAULT_CUSTOM_PROVIDER_HARNESS, () =>
              customProviders
                .save(input)
                .pipe(
                  Effect.mapError(
                    (error) => new AgentLifecycleFailed({ operation: "saveCustomProvider", cause: error.cause }),
                  ),
                ),
            )
            .pipe(toProviderRuntimeFailure);
          return {
            providers,
            restart: yield* serve(input.id, previous).pipe(toProviderRuntimeFailure),
          };
        })().pipe(Effect.uninterruptible),
      ),
    update: (input) => serialize(() => update(input)),
    peerUpdate: (input) => serialize(() => update(withSavedModelSettings(input))),
    peerHarnessUpdate: (input, harness) => serialize(() => update({ ...withSavedModelSettings(input), harness })),
    remove: (id) =>
      serialize(() =>
        Effect.fn("CustomProviderChanges.remove")(function* () {
          const previous = harnessOf(id);
          const providers = yield* service
            .removeCustomProvider(id, () =>
              customProviders
                .remove(id)
                .pipe(
                  Effect.mapError(
                    (error) => new AgentLifecycleFailed({ operation: "removeCustomProvider", cause: error.cause }),
                  ),
                ),
            )
            .pipe(toProviderRuntimeFailure);
          return {
            providers,
            restart: yield* restart(previous, undefined).pipe(toProviderRuntimeFailure),
          };
        })().pipe(Effect.uninterruptible),
      ),
  };
}

export type PeerCustomProviderChanges = Pick<
  CustomProviderChanges,
  "list" | "save" | "peerUpdate" | "peerHarnessUpdate" | "remove"
>;
