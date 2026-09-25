// Storage: what the files, chats and caches of the local host or a joined server take on disk.
//
// Every method takes the server explicitly, because Server Settings can be open for a server that
// is not the selected one. A remote host that predates `storage-v1` answers 404, so a read returns
// null before the request and the surface says the host needs an update; a change is refused.

import {
  assertStorageUsageScope,
  decodeStorageUsage,
  parseClearStorageInput,
  parseDeleteStoredFileInput,
  parseGetStorageUsageInput,
  parseOpenStorageLocationInput,
  parseOpenStoredFileInput,
  STORAGE_CAPABILITY,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import { STORAGE_ROUTES } from "@openbot/contracts/team-protocol/storage-v1";
import type { StorageAgent, StorageUsageService } from "../../backend/storage-usage";
import type { ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import { agentRequest } from "./agent-inputs";
import { type OpenAttachmentDependencies, openAttachmentForServer } from "./attachment-handlers";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { scopedHandler } from "./scoped-handler";

/** The RemoteServerManager members this registrar reaches, and nothing else. */
export interface StorageRemoteServers extends Pick<OpenAttachmentDependencies["remoteServers"], "downloadAttachment"> {
  supportsCapability(serverId: string, capability: TeamCurrentCapability): boolean;
  request<T>(serverId: string, path: string, decoder: ResponseDecoder<T>, init?: RemoteRequestInit): Promise<T>;
}

export interface StorageIpcDependencies extends Omit<OpenAttachmentDependencies, "remoteServers"> {
  storage: Pick<StorageUsageService, "usage" | "deleteFile" | "clear">;
  remoteServers: StorageRemoteServers;
  agents: () => StorageAgent[];
  openPath: (path: string) => Promise<string>;
}

/** Delete and clear answer an empty object. The transport codec has already checked its shape. */
function decodeStorageChange(value: unknown): undefined {
  if (value !== undefined && value !== null && !(isDynamicRecord(value) && Object.keys(value).length === 0))
    throw new Error("The remote server returned data.");
  return undefined;
}

export function storageIpcHandlers({
  storage,
  mailbox,
  remoteServers,
  getMainWindow,
  agents,
  openPath,
}: StorageIpcDependencies): Pick<IpcGroupHandlers, "storage"> {
  async function remoteChange(serverId: string, path: string, body: unknown): Promise<void> {
    if (!remoteServers.supportsCapability(serverId, STORAGE_CAPABILITY))
      throw new Error("Storage is not supported by this server.");
    return remoteServers.request(serverId, path, decodeStorageChange, { method: "POST", body });
  }

  return {
    storage: {
      getUsage: scopedHandler(parseGetStorageUsageInput, {
        local: (parsed) => storage.usage(parsed),
        remote: async (parsed, serverId) => {
          if (!remoteServers.supportsCapability(serverId, STORAGE_CAPABILITY)) return null;
          const usage = await remoteServers.request(serverId, STORAGE_ROUTES.usage, decodeStorageUsage, {
            method: "POST",
            body: parsed,
          });
          return assertStorageUsageScope(usage, parsed);
        },
      }),
      deleteFile: scopedHandler(parseDeleteStoredFileInput, {
        local: (parsed) => storage.deleteFile(parsed.fileId),
        remote: (parsed, serverId) => remoteChange(serverId, STORAGE_ROUTES.deleteFile, parsed),
      }),
      clear: scopedHandler(parseClearStorageInput, {
        local: (parsed) => storage.clear(parsed.category),
        remote: (parsed, serverId) => remoteChange(serverId, STORAGE_ROUTES.clear, parsed),
      }),
      // A stored file is a sent or generated attachment, so the chat's open path serves it.
      openFile: payloadHandler(agentRequest(parseOpenStoredFileInput), (scoped) => {
        const parsed = scoped.payload;
        return openAttachmentForServer({ mailbox, remoteServers, getMainWindow }, scoped.serverId, {
          attachmentId: parsed.fileId,
          action: parsed.action,
        });
      }),
      // Local only: a remote host's workspace is a path on another computer.
      openLocation: payloadHandler(parseOpenStorageLocationInput, async ({ agentId }) => {
        const agent = agents().find((candidate) => candidate.id === agentId);
        if (!agent) throw new Error("The agent does not exist.");
        const error = await openPath(agent.workspacePath);
        if (error) throw new Error(error);
      }),
    },
  };
}
