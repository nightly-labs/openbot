import type { AgentProfile } from "@openbot/ui/data";
import { StorageOverview } from "@openbot/ui/features/files/StorageOverview";
import { createEffect, createSignal } from "solid-js";
import { toAgentProfile } from "../../app-message-projection";
import { type FilesPort, filesPort } from "./files-port";
import { createStorageUsage } from "./storage-usage";

export interface ServerStorageOptions {
  /** The computer the numbers belong to, such as "This Mac" or the server name. */
  hostName: string;
  /** Owners and admins clear caches and delete files. A member only reads. */
  canManage: boolean;
  onOpenAgent: (agentId: string) => void;
  onShowMessage: (agentId: string, messageId: string) => void;
  /** The storage calls of a client with no `window.openbot`, such as the web client. */
  calls?: FilesPort;
}

/**
 * Server Settings > Storage: every location on the host, its agents, its largest chats and every
 * stored file. The agents are read for this server, because the dialog can be open for a server
 * that is not the selected one and the selected server's agents would name the wrong rows.
 */
export function ServerStoragePanel(props: ServerStorageOptions & { serverId: string }) {
  const calls = () => props.calls ?? filesPort();
  const storage = createStorageUsage(() => ({ serverId: props.serverId, input: { scope: "host" } }), calls);
  const [agents, setAgents] = createSignal<AgentProfile[]>([]);
  createEffect(
    () => props.serverId,
    (serverId) => {
      let current = true;
      calls()
        .agent.listAgents(serverId)
        .then((list) => {
          if (current) setAgents(list.map(toAgentProfile));
        })
        // Without names the rows still show sizes; the storage read reports its own failure.
        .catch(() => undefined);
      return () => {
        current = false;
      };
    },
  );

  const usage = () => storage.state.usage;

  return (
    <StorageOverview
      hostName={props.hostName}
      state={storage.scanState()}
      error={storage.error()}
      scannedAt={usage()?.scannedAt ?? null}
      breakdown={usage()?.breakdown ?? []}
      freeBytes={usage()?.freeBytes ?? null}
      agents={agents()}
      agentUsage={usage()?.agents ?? []}
      conversations={usage()?.conversations ?? []}
      files={usage()?.files ?? []}
      canManage={props.canManage}
      onRescan={() => void storage.refresh(true)}
      onOpenAgent={props.onOpenAgent}
      onOpenConversation={(conversationId) => {
        const agentId = usage()?.conversations.find((chat) => chat.id === conversationId)?.agentId;
        if (agentId) props.onOpenAgent(agentId);
      }}
      onClear={storage.clear}
      // Settings has no preview pane, so a preview opens the file in its app.
      onPreviewFile={(file) => void storage.fileAction(file, "open", { onShowInChat: () => undefined })}
      onFileAction={(file, action) =>
        storage.fileAction(file, action, {
          onShowInChat: (row) => {
            if (row.agentId && row.messageId) props.onShowMessage(row.agentId, row.messageId);
          },
        })
      }
    />
  );
}
