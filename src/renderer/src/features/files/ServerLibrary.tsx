import { agentAccessRank, canPreviewAttachment, type FilePreview, type ServerSummary } from "@openbot/contracts/ipc";
import { AGENT_ACCESS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-access-v1";
import { classifyFailure } from "@openbot/telemetry";
import type { AgentProfile } from "@openbot/ui/data";
import type { AttachmentMediaSource } from "@openbot/ui/features/conversation/AttachmentCards";
import type { StoredFileAction, StoredFileRow } from "@openbot/ui/features/files/files-view";
import { LibraryPage } from "@openbot/ui/features/files/LibraryPage";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, flush, Loading, lazy, onCleanup, Show, untrack } from "solid-js";
import { actionToast } from "../../action-toast";
import { usePlatform } from "../../platform";
import { attachmentFilePreview } from "../conversation/attachment-preview";
import { type AgentLevelsSource, createAgentLevels } from "../conversation/message-delete-access";
import { serverRoleCanAdminister, serverSupportsCapability } from "../servers/server-capabilities";
import type { FilesPort } from "./files-port";
import { readLibraryCollapsedRows, saveLibraryCollapsedRows } from "./library-collapsed-storage";
import { createLibraryFolders } from "./library-folders";
import { canManageStorage, createServerAgents, createStorageUsage } from "./storage-usage";
import { escapeClosesViewer } from "./viewer-escape";

const FilePreviewPanel = lazy(() => import("../conversation/FilePreviewPanel"));

/** The viewer fills the page, so the panel takes the largest width it has. */
const VIEWER_WIDTH = 4000;

interface Viewing {
  file: StoredFileRow;
  preview: FilePreview;
  /** The tile that opened the file. Focus goes back to it when the viewer closes. */
  origin: HTMLElement | undefined;
}

export interface ServerLibraryProps {
  serverId: string;
  /** The server of `serverId`, for its role and its capabilities. */
  server: ServerSummary | undefined;
  /** The storage and agent calls: the desktop bridge, or the requests of the web client. */
  calls: () => FilesPort;
  /** Reads the levels of a member on a joined server, and tells when they change. */
  levels: Pick<AgentLevelsSource, "readLevels" | "onLevelsChanged">;
  onShowInChat: (agentId: string, messageId: string) => void;
  onOpenUrl: (url: string) => void;
  /** Reads the pictures that have no `previewUrl`: the web client gets none. */
  mediaSource?: AttachmentMediaSource | undefined;
  /** The files are on this computer: they open in their app and show in their folder. The default is true. */
  opensFiles?: boolean | undefined;
}

/**
 * The Library of one server: every file and picture of its chats. A file that the app can show opens
 * in the file viewer over the page; any other file opens in its app, or downloads on the web client.
 */
export function ServerLibrary(props: ServerLibraryProps) {
  const { t, errorMessage } = useText();
  const platform = usePlatform();
  const storage = createStorageUsage(() => ({ serverId: props.serverId, input: { scope: "host" } }), props.calls);
  const agents = createServerAgents(() => props.serverId, props.calls);
  const [viewing, setViewing] = createSignal<Viewing | null>(null);
  const agentIds = createMemo(() => new Set((agents() ?? []).map((agent) => agent.id)));
  const fileAgents = createMemo(
    () => new Map((storage.state.usage?.files ?? []).map((file) => [file.id, file.agentId] as const)),
  );
  /** The joined server whose roles decide who changes the folders of an agent. Null: each viewer does. */
  const levelsServerId = () => {
    const current = props.server;
    return current?.kind === "remote" &&
      !serverRoleCanAdminister(current) &&
      serverSupportsCapability(current, AGENT_ACCESS_CAPABILITY)
      ? current.id
      : null;
  };
  const level = createAgentLevels({ levelsServerId, ...props.levels });
  /** A member changes the folders of an agent that they can chat with. The host checks it again. */
  const canOrganize = (agentId: string) => {
    if (levelsServerId() === null) return true;
    const known = level(agentId);
    return known !== undefined && agentAccessRank(known) >= agentAccessRank("chat");
  };
  // Each member reads the folders. Only the delete of files needs `canDelete`.
  const folders = createLibraryFolders(
    () => props.serverId,
    () => ({ agentIds: agentIds(), fileAgent: (fileId) => fileAgents().get(fileId) }),
    props.calls,
  );
  // A new scan follows a change of the files on the host. The folders load again with it, so they match the files.
  createEffect(
    () => storage.state.loading,
    (loading, was) => {
      if (was === true && !loading) folders.reload();
    },
  );
  const hasFolders = () => (folders.snapshot() ? "" : undefined);
  const canDelete = () => {
    const current = props.server;
    return current ? canManageStorage(current) : false;
  };
  const macWindowControls = () => platform.appInfo()?.platform === "darwin";

  // The page calls this after a change, outside a tracking scope. The server of that moment is the right one.
  function saveCollapsedRows(keys: readonly string[]): void {
    saveLibraryCollapsedRows(
      untrack(() => props.serverId),
      keys,
    );
  }

  function showInChat(file: StoredFileRow): void {
    if (file.agentId && file.messageId) props.onShowInChat(file.agentId, file.messageId);
  }

  function act(file: StoredFileRow, action: StoredFileAction): Promise<void> {
    return storage.fileAction(file, action, { onShowInChat: showInChat });
  }

  async function open(file: StoredFileRow, origin: HTMLElement | undefined): Promise<void> {
    if (!canPreviewAttachment(file) || !file.previewUrl) return act(file, "open");
    try {
      const preview = await attachmentFilePreview(file);
      if (preview.previewKind === "none") return act(file, "open");
      // A list row gives no origin. The row that has focus opened the file.
      const focused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
      setViewing({ file, preview, origin: origin ?? focused });
    } catch (error) {
      actionToast.error(t("files.storage.openFailed", { name: file.name }), {
        description: errorMessage(error, t("files.storage.tryAgain")),
        report: { operation: "other", source: "action", cause_code: classifyFailure(error) },
      });
    }
  }

  function closeViewer(): void {
    const origin = viewing()?.origin;
    setViewing(null);
    // The page stays inert until the update applies, and an inert tile cannot take focus.
    flush();
    if (origin?.isConnected) origin.focus({ preventScroll: true });
  }

  return (
    <div class="library-panel">
      <div class="library-panel-content" data-folders={hasFolders()} inert={viewing() !== null}>
        {/* The first answer tells if the host has folders. The page waits for it, so it does not change its form. */}
        <Show when={folders.ready()}>
          <LibraryPage
            files={storage.state.usage?.files ?? []}
            agents={agents()}
            loading={storage.scanState() === "scanning" && !storage.state.usage}
            error={storage.error()}
            onRetry={() => void storage.refresh(true)}
            canDelete={canDelete()}
            macWindowControls={macWindowControls()}
            onOpen={(file, origin) => void open(file, origin)}
            onAction={act}
            onDeleteFiles={storage.deleteFiles}
            onSaveFiles={storage.saveFiles}
            folders={folders.snapshot()}
            onFolderAction={folders.change}
            canOrganize={canOrganize}
            initialCollapsed={readLibraryCollapsedRows(props.serverId)}
            onCollapsedChange={saveCollapsedRows}
            mediaSource={props.mediaSource}
            opensFiles={props.opensFiles}
          />
        </Show>
      </div>
      <Show when={viewing()} keyed>
        {(shown) => (
          <LibraryViewer
            viewing={shown}
            agents={agents() ?? []}
            opensFiles={props.opensFiles !== false}
            onAction={act}
            onOpenUrl={props.onOpenUrl}
            onClose={closeViewer}
          />
        )}
      </Show>
    </div>
  );
}

/** The file over the Library page, at the full size of the page. Escape or the close button closes it. */
function LibraryViewer(props: {
  viewing: Viewing;
  agents: AgentProfile[];
  opensFiles: boolean;
  onAction: (file: StoredFileRow, action: StoredFileAction) => Promise<void>;
  onOpenUrl: (url: string) => void;
  onClose: () => void;
}) {
  const platform = usePlatform();
  const onKeyDown = (event: KeyboardEvent) => {
    if (escapeClosesViewer(event)) props.onClose();
  };
  document.addEventListener("keydown", onKeyDown);
  onCleanup(() => document.removeEventListener("keydown", onKeyDown));
  const file = () => props.viewing.file;
  const reveal = () => void props.onAction(file(), "reveal");
  const onReveal = () => (props.opensFiles ? reveal : undefined);
  return (
    // The page under the viewer is inert, so the viewer is the only part that takes input.
    <section
      class="library-viewer"
      aria-label={file().name}
      tabindex="-1"
      ref={(element) => requestAnimationFrame(() => element.focus({ preventScroll: true }))}
    >
      <Loading>
        <FilePreviewPanel
          macWindowControls={platform.appInfo()?.platform === "darwin"}
          preview={props.viewing.preview}
          agents={props.agents}
          sourceUrl={file().previewUrl ?? null}
          defaultWidth={() => VIEWER_WIDTH}
          maxWidth={() => VIEWER_WIDTH}
          onWidthChange={() => undefined}
          onOpenLink={props.onOpenUrl}
          onOpenSharedFile={() => undefined}
          allowExternalOpen={props.opensFiles}
          onOpenExternally={() => void props.onAction(file(), "open")}
          onDownload={() => void props.onAction(file(), "download")}
          onReveal={onReveal()}
          onClose={props.onClose}
        />
      </Loading>
    </section>
  );
}
