import { LOCAL_SERVER_ID, type RemovableRuntimes, type TeamMemberSummary } from "@openbot/contracts/ipc";
import type { AgentProfile } from "@openbot/ui/data";
import { MachineResources } from "@openbot/ui/features/files/MachineResources";
import { StorageOverview } from "@openbot/ui/features/files/StorageOverview";
import { createEffect, createSignal, Show, untrack } from "solid-js";
import { toAgentProfile } from "../../app-message-projection";
import { type FilesPort, filesPort } from "./files-port";
import { createMachineResources } from "./machine-resources";
import { createStorageUsage } from "./storage-usage";

export interface ServerStorageOptions {
  /** The computer the numbers belong to, such as "This Mac" or the server name. */
  hostName: string;
  /** Owners and admins clear caches and delete files. A member only reads. */
  canManage: boolean;
  onOpenAgent: (agentId: string) => void;
  onShowMessage: (agentId: string, messageId: string) => void;
  /** The members of the server. An owner or admin among them gets the machine alerts. */
  members?: readonly TeamMemberSummary[];
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
  const machine = createMachineResources(() => ({ serverId: props.serverId, canManage: props.canManage }), calls);
  const [agents, setAgents] = createSignal<AgentProfile[]>([]);
  createEffect(
    () => props.serverId,
    (serverId) => {
      let current = true;
      untrack(calls)
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

  // Only this computer: a server removes its own old versions, and its store is not reachable here.
  const runtimes = () => {
    const { getRemovableRuntimes, removeRemovableRuntimes } = calls().storage;
    return props.serverId === LOCAL_SERVER_ID && getRemovableRuntimes && removeRemovableRuntimes
      ? { getRemovableRuntimes, removeRemovableRuntimes }
      : undefined;
  };
  const noRuntimes: RemovableRuntimes = { bytes: 0, providers: [] };
  const [removableRuntimes, setRemovableRuntimes] = createSignal<RemovableRuntimes>(noRuntimes);
  // Read again after each scan, so "Measure again" and a removal both show the new size.
  createEffect(
    () => [storage.state.usage, runtimes()] as const,
    ([scan, port]) => {
      if (!scan || !port) return;
      let current = true;
      port
        .getRemovableRuntimes()
        .then((removable) => {
          if (current) setRemovableRuntimes(removable);
        })
        // Hide the row rather than show an old size; the storage read reports its own failures.
        .catch(() => {
          if (current) setRemovableRuntimes(noRuntimes);
        });
      return () => {
        current = false;
      };
    },
  );

  async function removeRuntimes(): Promise<void> {
    const port = runtimes();
    if (!port) return;
    try {
      setRemovableRuntimes(await port.removeRemovableRuntimes());
    } finally {
      await storage.refresh(true);
    }
  }

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
      runtimeBytes={runtimes() ? removableRuntimes().bytes : 0}
      runtimeProviders={removableRuntimes().providers}
      onRemoveRuntimes={removeRuntimes}
      // Settings has no preview pane, so a preview opens the file in its app.
      onPreviewFile={(file) => void storage.fileAction(file, "open", { onShowInChat: () => undefined })}
      machine={
        <Show when={machine.state.available}>
          <MachineResources
            metrics={machine.state.metrics}
            error={machine.state.error}
            alerts={machine.state.alerts}
            members={props.members ?? []}
            onChangeAlerts={machine.saveAlerts}
          />
        </Show>
      }
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
