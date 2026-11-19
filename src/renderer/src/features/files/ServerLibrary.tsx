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
import { createLibraryFolders } from "./library-folders";
import {
  readLibraryCollapsedRows,
  readLibraryFavorites,
  saveLibraryCollapsedRows,
  saveLibraryFavorites,
} from "./library-rows-storage";
import { canManageStorage, createServerAgents, createStorageUsage } from "./storage-usage";
import { escapeClosesViewer } from "./viewer-escape";

const FilePreviewPanel = lazy(() => import("../conversation/FilePreviewPanel"));

const VIEWER_WIDTH = 4000;

interface Viewing {
  file: StoredFileRow;
  preview: FilePreview;
  origin: HTMLElement | undefined;
}

export interface ServerLibraryProps {
  serverId: string;
  server: ServerSummary | undefined;
  calls: () => FilesPort;
  levels: Pick<AgentLevelsSource, "readLevels" | "onLevelsChanged">;
  onShowInChat: (agentId: string, messageId: string) => void;
  onOpenUrl: (url: string) => void;
  mediaSource?: AttachmentMediaSource | undefined;
  opensFiles?: boolean | undefined;
}

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
  const levelsServerId = () => {
    const current = props.server;
    return current?.kind === "remote" &&
      !serverRoleCanAdminister(current) &&
      serverSupportsCapability(current, AGENT_ACCESS_CAPABILITY)
      ? current.id
      : null;
  };
  const level = createAgentLevels({ levelsServerId, ...props.levels });
  const canOrganize = (agentId: string) => {
    if (levelsServerId() === null) return true;
    const known = level(agentId);
    return known !== undefined && agentAccessRank(known) >= agentAccessRank("chat");
  };
  const folders = createLibraryFolders(
    () => props.serverId,
    () => ({ agentIds: agentIds(), fileAgent: (fileId) => fileAgents().get(fileId) }),
    props.calls,
  );
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

  function saveCollapsedRows(keys: readonly string[]): void {
    saveLibraryCollapsedRows(
      untrack(() => props.serverId),
      keys,
    );
  }

  function saveFavorites(keys: readonly string[]): void {
    saveLibraryFavorites(
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
    flush();
    if (origin?.isConnected) origin.focus({ preventScroll: true });
  }

  return (
    <div class="library-panel">
      <div class="library-panel-content" data-folders={hasFolders()} inert={viewing() !== null}>
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
            initialFavorites={readLibraryFavorites(props.serverId)}
            onFavoritesChange={saveFavorites}
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
