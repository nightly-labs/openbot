import { isDeleteSharedTableInput, isSharedTable, type SharedTable } from "@openbot/contracts/ipc";
import { guardedDecoder, guardedListDecoder } from "@openbot/contracts/ipc-decoding";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import { SHARED_TABLES_CAPABILITY, SHARED_TABLES_ROUTES } from "@openbot/contracts/team-protocol/shared-tables-v1";
import { sourceText } from "@openbot/i18n/source";
import type { Effect } from "effect";
import type { AgentService } from "../../backend/agent-service";
import { runCauseEffect } from "../../backend/effect-boundary";
import { acceptEmpty, type ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import type { RemoteWorkflowError } from "../remote-service-effects";
import type { IpcGroupHandlers } from "./define-ipc-group";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";

const parseDeleteSharedTable = guardedDecoder(isDeleteSharedTableInput, "table deletion request");
const decodeRemoteTables = guardedListDecoder(isSharedTable, "remote shared tables");

interface SharedTableRemoteServers {
  supportsCapability(serverId: string, capability: TeamCurrentCapability): boolean;
  request<T>(
    serverId: string,
    path: string,
    decoder: ResponseDecoder<T>,
    init?: RemoteRequestInit,
  ): Effect.Effect<T, RemoteWorkflowError>;
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
        local: () => runCauseEffect(service.listTables()),
        remote: (serverId): Promise<SharedTable[]> | SharedTable[] =>
          remoteServers.supportsCapability(serverId, SHARED_TABLES_CAPABILITY)
            ? runCauseEffect(
                remoteServers.request(serverId, SHARED_TABLES_ROUTES.list, decodeRemoteTables, {
                  method: "POST",
                  body: {},
                }),
              )
            : [],
      }),
      deleteTable: scopedHandler(parseDeleteSharedTable, {
        local: (input) => runCauseEffect(service.deleteTable(input)),
        remote: (input, serverId) => {
          if (!remoteServers.supportsCapability(serverId, SHARED_TABLES_CAPABILITY))
            throw new Error(sourceText("error.backend.sharedDataLocalOnly"));
          return runCauseEffect(
            remoteServers.request(serverId, SHARED_TABLES_ROUTES.delete, acceptEmpty, {
              method: "POST",
              body: input,
            }),
          );
        },
      }),
    },
  };
}
