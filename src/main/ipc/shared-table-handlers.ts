// The tables agents create for themselves, in `~/OpenBot/Shared/Data/agent-data.db`.
//
// Neither call takes an agent: every agent shares every table, and the user's delete is not
// owner-gated -- the owner rule binds agents, not the person whose computer holds the data.

import { isDeleteSharedTableInput } from "@openbot/contracts/ipc";
import type { AgentService } from "../../backend/agent-service";
import { parseAgentRequest } from "./agent-inputs";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { routeToServer } from "./route-to-server";

interface SharedTableIpcDependencies {
  service: AgentService;
}

export function sharedTableIpcHandlers({
  service,
}: SharedTableIpcDependencies): Pick<IpcGroupHandlers, "sharedTables"> {
  return {
    sharedTables: {
      listTables: payloadHandler(parseAgentRequest, (scoped) =>
        routeToServer(scoped.serverId, {
          local: () => service.listTables(),
          // A remote server's data is on someone else's computer. Answering with an empty list
          // matches `listInstalledSkills`, and the UI hides the row for a remote server so an empty
          // list is never shown as fact.
          remote: () => [],
        }),
      ),
      deleteTable: payloadHandler(parseAgentRequest, (scoped) => {
        if (!isDeleteSharedTableInput(scoped.payload)) throw new Error("Invalid table deletion request.");
        const input = scoped.payload;
        return routeToServer(scoped.serverId, {
          local: () => service.deleteTable(input),
          remote: () => {
            throw new Error("Shared data is managed on the computer that runs these agents.");
          },
        });
      }),
    },
  };
}
