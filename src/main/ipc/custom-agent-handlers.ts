import { Effect, Semaphore } from "effect";
// The user's own ACP agents: list, save, delete and check. This computer only: no Team API route
// reaches these. `custom-agent-changes.ts` owns the order of the writes.

import type { CustomAgentChanges } from "../custom-agent-changes";
import { parseCheckCustomAgent, parseDeleteCustomAgent, parseSaveCustomAgent } from "./custom-agent-inputs";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

export function customAgentIpcHandlers(changes: CustomAgentChanges): Pick<IpcGroupHandlers, "customAgents"> {
  /**
   * One check at a time. A check starts a program and waits up to 20 seconds, so a renderer that
   * sent many at once would start many; the next one waits for the one before.
   */
  const checks = Semaphore.makeUnsafe(1);
  return {
    customAgents: {
      list: handler(() => Effect.runPromise(changes.list())),
      save: payloadHandler(parseSaveCustomAgent, (input) =>
        Effect.runPromise(changes.save(input).pipe(Effect.mapError((error) => error.cause))),
      ),
      delete: payloadHandler(parseDeleteCustomAgent, ({ id }) =>
        Effect.runPromise(changes.remove(id).pipe(Effect.mapError((error) => error.cause))),
      ),
      check: payloadHandler(parseCheckCustomAgent, (input) => {
        return Effect.runPromise(checks.withPermit(changes.check(input)).pipe(Effect.mapError((error) => error.cause)));
      }),
    },
  };
}
