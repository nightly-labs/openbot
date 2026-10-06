import { Effect, Semaphore } from "effect";
import { ProviderRuntimeFailure, runtimeSync } from "./provider-runtime-effects";
// The user's own model endpoints: list, add, remove. The local IPC handlers and the `providers-v1`
// host routes share one instance, so a change from a joined admin and a change from this window
// wait for each other.
//
// This module owns the order of the two writes, so the backend never has to know that a store
// exists: it is given a getter, and reads it again at every provider spawn.

import type {
  CustomProviderResult,
  CustomProviderSummary,
  SaveCustomProviderInput,
  UpdateCustomProviderInput,
} from "@openbot/contracts/ipc";
import { AgentLifecycleFailed, type AgentService } from "../backend/agent-service";
import type { CustomProviderStore } from "./custom-provider-store";

export interface CustomProviderChangeDependencies {
  // Only the endpoint-change methods, so the order of writes can be checked without a running
  // backend.
  service: Pick<
    AgentService,
    "saveCustomProvider" | "updateCustomProvider" | "removeCustomProvider" | "reloadOpenCodeConfig"
  >;
  customProviders: Pick<CustomProviderStore, "list" | "save" | "checkUpdate" | "update" | "remove">;
}

export interface CustomProviderChanges {
  /** The endpoints without their keys or header values. */
  list(): CustomProviderSummary[];
  save(input: SaveCustomProviderInput): Effect.Effect<CustomProviderResult, ProviderRuntimeFailure>;
  /** This computer only: the Team API routes take `PeerCustomProviderChanges`. */
  update(input: UpdateCustomProviderInput): Effect.Effect<CustomProviderResult, ProviderRuntimeFailure>;
  remove(id: string): Effect.Effect<CustomProviderResult, ProviderRuntimeFailure>;
}

export function createCustomProviderChanges({
  service,
  customProviders,
}: CustomProviderChangeDependencies): CustomProviderChanges {
  /**
   * One endpoint change at a time, from the first read to the last write.
   *
   * A delete reads the live catalogue to pick a fallback, then writes the file, then records the
   * exclusion. Two deletes that overlap both pick before either records, so each moves its agents
   * onto the endpoint the other is removing, and both agents end on a model no longer served. The
   * store's own chain cannot prevent this: the reassignment happens before the store is called. A
   * failed change does not stop the next one, so the chain swallows the rejection it re-throws to
   * its own caller.
   */
  const gate = Semaphore.makeUnsafe(1);
  function serialize<T>(run: () => Effect.Effect<T, ProviderRuntimeFailure>): Effect.Effect<T, ProviderRuntimeFailure> {
    return gate.withPermit(Effect.suspend(run));
  }

  return {
    list: () => customProviders.list(),
    /**
     * Persist first, then restart. The save resolves on the durable write plus the restart outcome,
     * and deliberately not on model discovery, which can take the full request timeout: the models
     * arrive through the ready `status` event, like every other provider's.
     */
    save: (input) =>
      serialize(() =>
        Effect.fn("CustomProviderChanges.save")(function* () {
          // The backend owns this order as well: it excludes the id being saved, then runs the write.
          // The id is served again only once a new process has read the file, which the backend hears
          // from the provider runtime. A restart that is skipped or that fails leaves the CLI
          // answering on the endpoints as they were, so the id stays out -- whether it was removed
          // before this write or already named models in that process's catalogue.
          const providers = yield* service
            .saveCustomProvider(input.id, () =>
              customProviders
                .save(input)
                .pipe(
                  Effect.mapError(
                    (error) => new AgentLifecycleFailed({ operation: "saveCustomProvider", cause: error.cause }),
                  ),
                ),
            )
            .pipe(Effect.mapError((error) => new ProviderRuntimeFailure({ cause: error.cause })));
          return {
            providers,
            restart: yield* service
              .reloadOpenCodeConfig()
              .pipe(Effect.mapError((error) => new ProviderRuntimeFailure({ cause: error.cause }))),
          };
        })().pipe(Effect.uninterruptible),
      ),
    /**
     * Like `save`, and the agents on a model that the edit takes out move first. The store checks
     * the edit before that, so an edit it refuses moves no agent.
     */
    update: (input) =>
      serialize(() =>
        Effect.fn("CustomProviderChanges.update")(function* () {
          yield* runtimeSync(() => customProviders.checkUpdate(input));
          const saved = customProviders.list().find((provider) => provider.id === input.id);
          const kept = new Set(input.models.map((model) => model.id));
          const removed = (saved?.models ?? []).filter((model) => !kept.has(model.id)).map((model) => model.id);
          const providers = yield* service
            .updateCustomProvider(input.id, removed, () =>
              customProviders
                .update(input)
                .pipe(
                  Effect.mapError(
                    (error) => new AgentLifecycleFailed({ operation: "updateCustomProvider", cause: error.cause }),
                  ),
                ),
            )
            .pipe(Effect.mapError((error) => new ProviderRuntimeFailure({ cause: error.cause })));
          return {
            providers,
            restart: yield* service
              .reloadOpenCodeConfig()
              .pipe(Effect.mapError((error) => new ProviderRuntimeFailure({ cause: error.cause }))),
          };
        })().pipe(Effect.uninterruptible),
      ),
    /**
     * Agents move off the endpoint's models *before* it is removed, so no agent is left naming a
     * model the restarted CLI does not list.
     */
    remove: (id) =>
      serialize(() =>
        Effect.fn("CustomProviderChanges.remove")(function* () {
          // The backend owns this order: it excludes the endpoint, moves the agents off it, and runs
          // the write as one change no agent update can interleave with. A write that throws gives the
          // exclusion back, because the endpoint is then still saved and still served.
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
            .pipe(Effect.mapError((error) => new ProviderRuntimeFailure({ cause: error.cause })));
          return {
            providers,
            restart: yield* service
              .reloadOpenCodeConfig()
              .pipe(Effect.mapError((error) => new ProviderRuntimeFailure({ cause: error.cause }))),
          };
        })().pipe(Effect.uninterruptible),
      ),
  };
}

/** What a joined admin may change through the Team API. There is no edit route. */
export type PeerCustomProviderChanges = Pick<CustomProviderChanges, "list" | "save" | "remove">;
