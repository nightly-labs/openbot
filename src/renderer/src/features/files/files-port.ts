import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

export interface FilesPort {
  agent: Pick<OpenBotDesktopApi["agent"], "listAgents">;
  storage: Pick<OpenBotDesktopApi["storage"], "clear" | "deleteFile" | "getUsage" | "openFile"> &
    Partial<
      Pick<
        OpenBotDesktopApi["storage"],
        | "getRemovableRuntimes"
        | "removeRemovableRuntimes"
        | "getMachineMetrics"
        | "getDisk"
        | "getLibraryFolders"
        | "changeLibraryFolders"
      >
    >;
  hostAdmin?: Pick<OpenBotDesktopApi["hostAdmin"], "getMachineAlerts" | "setMachineAlerts">;
  backgroundProcesses?: Pick<OpenBotDesktopApi["backgroundProcesses"], "list" | "stop">;
  onLibraryFoldersChanged?: (serverId: string, listener: () => void) => () => void;
}

export function filesPort(): FilesPort {
  const api = window.openbot;
  return {
    agent: api.agent,
    storage: api.storage,
    hostAdmin: api.hostAdmin,
    backgroundProcesses: api.backgroundProcesses,
    onLibraryFoldersChanged: (serverId, listener) =>
      api.agent.onScopedEvent((scoped) => {
        if (scoped.serverId === serverId && scoped.event.type === "library-folders-changed") listener();
      }),
  };
}
