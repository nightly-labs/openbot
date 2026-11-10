import {
  LOCAL_SERVER_ID,
  type RemovableRuntimes,
  type StorageDisk,
  type TeamMemberSummary,
} from "@openbot/contracts/ipc";
import { MachineResources } from "@openbot/ui/features/files/MachineResources";
import { StorageOverview } from "@openbot/ui/features/files/StorageOverview";
import { BackgroundProcessesSection } from "@openbot/ui/features/settings/BackgroundProcessesSection";
import { createEffect, createSignal, Show } from "solid-js";
import { type FilesPort, filesPort } from "./files-port";
import { createMachineResources } from "./machine-resources";
import { createServerBackgroundProcesses } from "./server-background-processes";
import { createServerAgents, createStorageUsage, planDisk } from "./storage-usage";

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
  /**
   * The joined server serves `background-processes-v1`. With `canManage`, Storage lists the programs
   * that its agents left running. This computer lists its own in Settings > Agents.
   */
  backgroundProcesses?: boolean;
}

/**
 * Server Settings > Storage: every location on the host, its agents, its largest chats and every
 * stored file. The agents are read for this server, because the dialog can be open for a server
 * that is not the selected one and the selected server's agents would name the wrong rows.
 */
export function ServerStoragePanel(
  props: ServerStorageOptions & {
    serverId: string;
    /** The plan storage in GB of a hosted server. The free space is then what the plan has left. */
    storageGb?: number | null;
  },
) {
  const calls = () => props.calls ?? filesPort();
  const storage = createStorageUsage(() => ({ serverId: props.serverId, input: { scope: "host" } }), calls);
  const machine = createMachineResources(() => ({ serverId: props.serverId, canManage: props.canManage }), calls);
  const agents = createServerAgents(() => props.serverId, calls);
  const processes = createServerBackgroundProcesses(
    () => ({
      serverId: props.serverId,
      shown:
        props.serverId !== LOCAL_SERVER_ID &&
        props.canManage &&
        props.backgroundProcesses === true &&
        calls().backgroundProcesses !== undefined,
    }),
    calls,
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

  // A hosted server shows the free space of its plan, as the sidebar storage card does. The disk is read
  // again after each scan; until it comes, the free space of the disk shows.
  const [disk, setDisk] = createSignal<{ scan: unknown; disk: StorageDisk } | null>(null);
  createEffect(
    () => [storage.state.usage, props.storageGb, calls().storage.getDisk] as const,
    ([scan, storageGb, getDisk]) => {
      if (!scan || !storageGb || !getDisk) return;
      let current = true;
      getDisk(props.serverId)
        .then((answer) => {
          if (current) setDisk(answer ? { scan, disk: answer } : null);
        })
        .catch(() => {
          if (current) setDisk(null);
        });
      return () => {
        current = false;
      };
    },
  );
  const freeBytes = () => {
    const scan = storage.state.usage;
    const read = disk();
    if (!scan) return null;
    return props.storageGb && read?.scan === scan ? planDisk(read.disk, props.storageGb).freeBytes : scan.freeBytes;
  };

  const usage = () => storage.state.usage;

  return (
    <StorageOverview
      hostName={props.hostName}
      state={storage.scanState()}
      error={storage.error()}
      scannedAt={usage()?.scannedAt ?? null}
      breakdown={usage()?.breakdown ?? []}
      freeBytes={freeBytes()}
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
        <>
          <Show when={machine.state.available}>
            <MachineResources
              metrics={machine.state.metrics}
              error={machine.state.error}
              alerts={machine.state.alerts}
              members={props.members ?? []}
              onChangeAlerts={machine.saveAlerts}
            />
          </Show>
          <Show when={processes.state.processes}>
            {(list) => (
              <BackgroundProcessesSection
                processes={list()}
                loadFailed={processes.state.loadFailed}
                agents={processes.state.agents}
                stopping={processes.state.stopping}
                onStop={processes.stop}
              />
            )}
          </Show>
        </>
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
