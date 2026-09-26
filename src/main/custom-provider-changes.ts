// The user's own model endpoints: list, add, remove. The local IPC handlers and the `providers-v1`
// host routes share one instance, so a change from a joined admin and a change from this window
// wait for each other.
//
// This module owns the order of the two writes, so the backend never has to know that a store
// exists: it is given a getter, and reads it again at every provider spawn.

import type { CustomProviderResult, CustomProviderSummary, SaveCustomProviderInput } from "@openbot/contracts/ipc";
import type { AgentService } from "../backend/agent-service";
import type { CustomProviderStore } from "./custom-provider-store";

export interface CustomProviderChangeDependencies {
  // Only the four endpoint-change methods, so the order of writes can be checked without a running
  // backend.
  service: Pick<AgentService, "saveCustomProvider" | "removeCustomProvider" | "reloadOpenCodeConfig">;
  customProviders: Pick<CustomProviderStore, "list" | "save" | "remove">;
}

export interface CustomProviderChanges {
  /** The endpoints without their keys or header values. */
  list(): CustomProviderSummary[];
  save(input: SaveCustomProviderInput): Promise<CustomProviderResult>;
  remove(id: string): Promise<CustomProviderResult>;
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
  let chain: Promise<unknown> = Promise.resolve();
  function serialize<T>(run: () => Promise<T>): Promise<T> {
    const operation = chain.then(run);
    chain = operation.catch(() => undefined);
    return operation;
  }

  return {
    list: () => customProviders.list(),
    /**
     * Persist first, then restart. The save resolves on the durable write plus the restart outcome,
     * and deliberately not on model discovery, which can take the full request timeout: the models
     * arrive through the ready `status` event, like every other provider's.
     */
    save: (input) =>
      serialize(async () => {
        // The backend owns this order as well: it excludes the id being saved, then runs the write.
        // The id is served again only once a new process has read the file, which the backend hears
        // from the provider runtime. A restart that is skipped or that fails leaves the CLI
        // answering on the endpoints as they were, so the id stays out -- whether it was removed
        // before this write or already named models in that process's catalogue.
        const providers = await service.saveCustomProvider(input.id, () => customProviders.save(input));
        return { providers, restart: await service.reloadOpenCodeConfig() };
      }),
    /**
     * Agents move off the endpoint's models *before* it is removed, so no agent is left naming a
     * model the restarted CLI does not list.
     */
    remove: (id) =>
      serialize(async () => {
        // The backend owns this order: it excludes the endpoint, moves the agents off it, and runs
        // the write as one change no agent update can interleave with. A write that throws gives the
        // exclusion back, because the endpoint is then still saved and still served.
        const providers = await service.removeCustomProvider(id, () => customProviders.remove(id));
        return { providers, restart: await service.reloadOpenCodeConfig() };
      }),
  };
}
