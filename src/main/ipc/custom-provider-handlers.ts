// The user's own model endpoints: list, add, remove.
//
// This registrar owns the order of the two writes, so the backend never has to know that a store
// exists: it is given a getter, and reads it again at every provider spawn.

import type { CustomProviderResult } from "@openbot/contracts/ipc";
import type { AgentService } from "../../backend/agent-service";
import type { CustomProviderStore } from "../custom-provider-store";
import { parseDeleteCustomProvider, parseSaveCustomProvider } from "./custom-provider-inputs";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

export interface CustomProviderIpcDependencies {
  // Only the four endpoint-change methods, so the registrar's order of writes can be checked without
  // a running backend.
  service: Pick<AgentService, "removeCustomProvider" | "noteCustomProviderSaved" | "reloadOpenCodeConfig">;
  customProviders: Pick<CustomProviderStore, "list" | "save" | "remove">;
}

export function customProviderIpcHandlers({
  service,
  customProviders,
}: CustomProviderIpcDependencies): Pick<IpcGroupHandlers, "customProviders"> {
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
    customProviders: {
      list: handler(() => customProviders.list()),
      /**
       * Persist first, then restart. The save resolves on the durable write plus the restart
       * outcome, and deliberately not on model discovery, which can take the full request timeout:
       * the models arrive through the ready `status` event, like every other provider's.
       */
      save: payloadHandler(
        parseSaveCustomProvider,
        (input): Promise<CustomProviderResult> =>
          serialize(async () => {
            const providers = await customProviders.save(input);
            // An id that was removed before serves the models of this write from now on -- and only
            // those, because the running CLI may still list the ones this save left out.
            service.noteCustomProviderSaved(
              input.id,
              input.models.map((model) => model.id),
            );
            return { providers, restart: await service.reloadOpenCodeConfig() };
          }),
      ),
      /**
       * Agents move off the endpoint's models *before* it is removed, so no agent is left naming a
       * model the restarted CLI does not list.
       */
      delete: payloadHandler(
        parseDeleteCustomProvider,
        ({ id }): Promise<CustomProviderResult> =>
          serialize(async () => {
            // The backend owns this order: it excludes the endpoint, moves the agents off it, and
            // runs the write as one change no agent update can interleave with. A write that throws
            // gives the exclusion back, because the endpoint is then still saved and still served.
            const providers = await service.removeCustomProvider(id, () => customProviders.remove(id));
            return { providers, restart: await service.reloadOpenCodeConfig() };
          }),
      ),
    },
  };
}
