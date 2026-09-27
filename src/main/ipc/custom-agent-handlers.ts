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
  let checks: Promise<unknown> = Promise.resolve();
  return {
    customAgents: {
      list: handler(() => changes.list()),
      save: payloadHandler(parseSaveCustomAgent, (input) => changes.save(input)),
      delete: payloadHandler(parseDeleteCustomAgent, ({ id }) => changes.remove(id)),
      check: payloadHandler(parseCheckCustomAgent, (input) => {
        const current = checks.then(() => changes.check(input));
        checks = current.catch(() => undefined);
        return current;
      }),
    },
  };
}
