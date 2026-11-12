import type { AgentProviderId } from "@openbot/contracts/agent-providers";
import { CopyAgentsDialog, type CopyAgentsServer } from "@openbot/ui/features/transfer/CopyAgentsDialog";
import { InstanceTransferView } from "@openbot/ui/features/transfer/InstanceTransferView";
import { createSignal, Show, untrack } from "solid-js";
import { createServerCopyStore, type ServerCopyCalls } from "./server-copy-store";
import { createServerTransferStore, type ServerTransferCalls } from "./server-transfer-store";

export interface ServerCopyOptions {
  /** The servers that the user administers with `instance-transfer-v1`, this one included. */
  servers: readonly CopyAgentsServer[];
  /** Closes the settings and opens the server. */
  onOpenServer: (serverId: string) => void;
  calls?: ServerCopyCalls;
}

export interface ServerTransferOptions {
  /** Signs in to a provider of this computer. Absent for a joined server, whose providers are its own. */
  onSignIn?: ((provider: AgentProviderId) => void) | undefined;
  /** The server can put the chat history in the file. */
  history?: boolean;
  /** The server chooses the channel messages apart from the chats, and has server preferences to export. */
  fullCopy?: boolean;
  calls?: ServerTransferCalls;
  /** Copy to another server. Absent when the user has no other server to copy to. */
  copy?: ServerCopyOptions | undefined;
}

/** Server settings > Transfer: the shared view, for one server. */
export function ServerTransferPanel(props: ServerTransferOptions & { serverId: string }) {
  const store = createServerTransferStore(props.serverId, props.calls ?? window.openbot.instanceTransfer);
  const [copyOpen, setCopyOpen] = createSignal(false);
  const openCopy = () => (props.copy ? () => setCopyOpen(true) : undefined);
  function openCopyOptions() {
    return copyOpen() ? props.copy : undefined;
  }
  return (
    <>
      <InstanceTransferView
        screen={store.state.screen}
        onScreenChange={(screen) => store.setScreen(screen)}
        summary={store.state.summary}
        exportPhase={store.state.exportPhase}
        exportFileName={store.state.exportFileName}
        exportWarnings={store.state.exportWarnings}
        exportError={store.state.exportError}
        onExport={(options) => store.exportFile(options)}
        historyAvailable={props.history}
        fullCopyAvailable={props.fullCopy}
        onShowExport={store.showExport}
        onExportAgain={() => store.exportAgain()}
        importPhase={store.state.importPhase}
        preview={store.state.preview}
        result={store.state.result}
        importError={store.state.importError}
        onChoose={() => store.choose()}
        onImport={(keys, includeSettings, includeServerPreferences) =>
          store.importFile(keys, includeSettings, includeServerPreferences)
        }
        onCancelImport={() => store.cancelImport()}
        onImportDone={() => store.importDone()}
        onSignIn={props.onSignIn}
        onCopy={openCopy()}
      />
      <Show when={openCopyOptions()}>
        {(copy) => <ServerCopy serverId={props.serverId} options={copy()} onClose={() => setCopyOpen(false)} />}
      </Show>
    </>
  );
}

/** A new copy each time the dialog opens. */
function ServerCopy(props: { serverId: string; options: ServerCopyOptions; onClose: () => void }) {
  // The dialog starts from this server, with the calls of the time it opens.
  const store = createServerCopyStore(
    untrack(() => props.serverId),
    () => props.options.servers,
    untrack(() => props.options.calls) ?? window.openbot.instanceTransfer,
  );
  const openServer = () => {
    const toId = store.state.toId;
    return toId && toId !== props.serverId ? () => props.options.onOpenServer(toId) : undefined;
  };
  return (
    <CopyAgentsDialog
      servers={props.options.servers}
      fromId={store.state.fromId}
      toId={store.state.toId}
      onFromChange={(id) => store.setFrom(id)}
      onToChange={(id) => store.setTo(id)}
      fromAgents={store.state.fromAgents}
      toAgents={store.state.toAgents}
      loadError={store.loadError()}
      phase={store.state.phase}
      result={store.state.result}
      error={store.state.error}
      onCopy={(agentIds) => store.copy(agentIds)}
      onOpenServer={openServer()}
      onClose={props.onClose}
    />
  );
}
