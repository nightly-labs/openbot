// The tables agents create for themselves, in `~/OpenBot/Shared/Data/agent-data.db`.
//
// Neither call takes an agent: every agent shares every table, and the user's delete is not
// owner-gated -- the owner rule binds agents, not the person whose computer holds the data. On a
// joined server the tables are on the host, which answers only an owner or admin.

import { isDeleteSharedTableInput, isSharedTable, type SharedTable } from "@openbot/contracts/ipc";
import { guardedDecoder, guardedListDecoder } from "@openbot/contracts/ipc-decoding";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import { SHARED_TABLES_CAPABILITY, SHARED_TABLES_ROUTES } from "@openbot/contracts/team-protocol/shared-tables-v1";
import { sourceText } from "@openbot/i18n/source";
import type { AgentService } from "../../backend/agent-service";
import type { ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import type { IpcGroupHandlers } from "./define-ipc-group";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";

const parseDeleteSharedTable = guardedDecoder(isDeleteSharedTableInput, "table deletion request");
const decodeRemoteTables = guardedListDecoder(isSharedTable, "remote shared tables");
// The shared-tables-v1 codec has already checked that the body is an empty record.
const acceptEmpty = (): undefined => undefined;

interface SharedTableRemoteServers {
  supportsCapability(serverId: string, capability: TeamCurrentCapability): boolean;
  request<T>(serverId: string, path: string, decoder: ResponseDecoder<T>, init?: RemoteRequestInit): Promise<T>;
}

interface SharedTableIpcDependencies {
  service: AgentService;
  remoteServers: SharedTableRemoteServers;
}

export function sharedTableIpcHandlers({
  service,
  remoteServers,
}: SharedTableIpcDependencies): Pick<IpcGroupHandlers, "sharedTables"> {
  return {
    sharedTables: {
      listTables: scopedQueryHandler({
        local: () => service.listTables(),
        // A host without the capability is answered with an empty list, as `listInstalledSkills`
        // does. The UI hides the row there and for a member, so an empty list is never shown as fact.
        remote: (serverId): Promise<SharedTable[]> | SharedTable[] =>
          remoteServers.supportsCapability(serverId, SHARED_TABLES_CAPABILITY)
            ? remoteServers.request(serverId, SHARED_TABLES_ROUTES.list, decodeRemoteTables, {
                method: "POST",
                body: {},
              })
            : [],
      }),
      deleteTable: scopedHandler(parseDeleteSharedTable, {
        local: (input) => service.deleteTable(input),
        remote: (input, serverId) => {
          if (!remoteServers.supportsCapability(serverId, SHARED_TABLES_CAPABILITY))
            throw new Error(sourceText("error.backend.sharedDataLocalOnly"));
          return remoteServers.request(serverId, SHARED_TABLES_ROUTES.delete, acceptEmpty, {
            method: "POST",
            body: input,
          });
        },
      }),
    },
  };
}
