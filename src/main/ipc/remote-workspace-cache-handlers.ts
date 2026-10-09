// The optional saved copy of a joined server. The renderer names a server; the store decides the
// account and refuses a server that is not joined, so a request cannot reach another account's copy.

import { runCauseEffect } from "../../backend/effect-boundary";
import type { RemoteWorkspaceCacheStore } from "../remote-workspace-cache";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import {
  parseRemoteWorkspaceCachePreference,
  parseSaveRemoteConversation,
  parseSaveRemoteWorkspace,
} from "./remote-workspace-cache-inputs";
import { stringPayload } from "./validation";

export interface RemoteWorkspaceCacheIpcDependencies {
  remoteWorkspaceCache: RemoteWorkspaceCacheStore;
}

export function remoteWorkspaceCacheIpcHandlers({
  remoteWorkspaceCache,
}: RemoteWorkspaceCacheIpcDependencies): Pick<IpcGroupHandlers, "remoteWorkspaceCache"> {
  return {
    remoteWorkspaceCache: {
      getPreference: handler(() => remoteWorkspaceCache.preference()),
      setPreference: payloadHandler(parseRemoteWorkspaceCachePreference, (parsed) =>
        runCauseEffect(remoteWorkspaceCache.setEnabled(parsed)),
      ),
      read: payloadHandler(stringPayload("Server ID"), (serverId) =>
        runCauseEffect(remoteWorkspaceCache.read(serverId)),
      ),
      saveWorkspace: payloadHandler(parseSaveRemoteWorkspace, (parsed) =>
        runCauseEffect(remoteWorkspaceCache.saveWorkspace(parsed)),
      ),
      saveConversation: payloadHandler(parseSaveRemoteConversation, (parsed) =>
        runCauseEffect(remoteWorkspaceCache.saveConversation(parsed)),
      ),
    },
  };
}
