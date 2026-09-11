// The user's own MCP servers: list, add, remove.

import type { CustomMcpFullAccessPreference, CustomMcpResult } from "@openbot/contracts/ipc";
import type { CustomMcpStore } from "../custom-mcp-store";
import { parseDeleteCustomMcp, parseSaveCustomMcp, parseSetCustomMcpFullAccess } from "./custom-mcp-inputs";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

export interface CustomMcpIpcDependencies {
  customMcp: Pick<CustomMcpStore, "list" | "save" | "remove" | "fullAccess" | "setFullAccess">;
}

export function customMcpIpcHandlers({ customMcp }: CustomMcpIpcDependencies): Pick<IpcGroupHandlers, "customMcp"> {
  let chain: Promise<unknown> = Promise.resolve();
  function serialize<T>(run: () => Promise<T>): Promise<T> {
    const operation = chain.then(run);
    chain = operation.catch(() => undefined);
    return operation;
  }

  return {
    customMcp: {
      list: handler(() => customMcp.list()),
      save: payloadHandler(
        parseSaveCustomMcp,
        (input): Promise<CustomMcpResult> => serialize(async () => ({ servers: await customMcp.save(input) })),
      ),
      delete: payloadHandler(
        parseDeleteCustomMcp,
        ({ id }): Promise<CustomMcpResult> => serialize(async () => ({ servers: await customMcp.remove(id) })),
      ),
      getFullAccess: handler((): CustomMcpFullAccessPreference => ({ enabled: customMcp.fullAccess() })),
      setFullAccess: payloadHandler(
        parseSetCustomMcpFullAccess,
        ({ enabled }): Promise<CustomMcpFullAccessPreference> =>
          serialize(async () => ({ enabled: await customMcp.setFullAccess(enabled) })),
      ),
    },
  };
}
