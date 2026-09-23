// The tables agents create for themselves, in `~/OpenBot/Shared/Data/agent-data.db`.
//
// Neither call takes an agent: every agent shares every table, and the user's delete is not
// owner-gated -- the owner rule binds agents, not the person whose computer holds the data.

import { isDeleteSharedTableInput } from "@openbot/contracts/ipc";
import { guardedDecoder } from "@openbot/contracts/ipc-decoding";
import type { AgentService } from "../../backend/agent-service";
import { agentRequest, agentScope } from "./agent-inputs";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { routeToServer } from "./route-to-server";

const parseDeleteSharedTable = guardedDecoder(isDeleteSharedTableInput, "table deletion request");

interface SharedTableIpcDependencies {
  service: AgentService;
}

export function sharedTableIpcHandlers({
  service,
}: SharedTableIpcDependencies): Pick<IpcGroupHandlers, "sharedTables"> {
  return {
    sharedTables: {
      listTables: payloadHandler(agentScope, (scoped) =>
        routeToServer(scoped.serverId, {
          local: () => service.listTables(),
          // A remote server's data is on someone else's computer. Answering with an empty list
          // matches `listInstalledSkills`, and the UI hides the row for a remote server so an empty
          // list is never shown as fact.
          remote: () => [],
        }),
      ),
      deleteTable: payloadHandler(agentRequest(parseDeleteSharedTable), (scoped) =>
        routeToServer(scoped.serverId, {
          local: () => service.deleteTable(scoped.payload),
          remote: () => {
            throw new Error("Shared data is managed on the computer that runs these agents.");
          },
        }),
      ),
    },
  };
}
