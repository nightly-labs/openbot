import { canPreviewAttachment, type FilePreview } from "@openbot/contracts/ipc";
import { classifyFailure } from "@openbot/telemetry";
import type { AgentProfile } from "@openbot/ui/data";
import type { StoredFileAction, StoredFileRow } from "@openbot/ui/features/files/files-view";
import { LibraryPage } from "@openbot/ui/features/files/LibraryPage";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, flush, Loading, lazy, onCleanup, Show, untrack } from "solid-js";
import { actionToast } from "../../action-toast";
import { toAgentProfile } from "../../app-message-projection";
import { appPort } from "../../app-port";
import { useNavigation } from "../../navigation";
import { usePlatform } from "../../platform";
import { attachmentFilePreview } from "../conversation/attachment-preview";
import { useServers } from "../servers/servers-context";
import { filesPort } from "./files-port";
import { canManageStorage, createStorageUsage } from "./storage-usage";

const FilePreviewPanel = lazy(() => import("../conversation/FilePreviewPanel"));

/** The viewer fills the page, so the panel takes the largest width it has. */
const VIEWER_WIDTH = 4000;

interface Viewing {
  file: StoredFileRow;
  preview: FilePreview;
  /** The tile that opened the file. Focus goes back to it when the viewer closes. */
  origin: HTMLElement | undefined;
}

/**
 * The Library page of the desktop window: every file and picture of the selected server's chats. A
 * file that the app can show opens in the file viewer over the page; any other file opens in its app.
 */
export function LibraryPanel(props: { serverId: string }) {
  const { t, errorMessage } = useText();
  const { servers } = useServers();
  const navigation = useNavigation();
  const platform = usePlatform();
  const storage = createStorageUsage(() => ({ serverId: props.serverId, input: { scope: "host" } }), filesPort);
  const [agents, setAgents] = createSignal<AgentProfile[]>([]);
  const [viewing, setViewing] = createSignal<Viewing | null>(null);
  const canDelete = () => {
    const server = servers().find((candidate) => candidate.id === props.serverId);
    return server ? canManageStorage(server) : false;
  };
  const macWindowControls = () => platform.appInfo()?.platform === "darwin";

  createEffect(
    () => props.serverId,
    (serverId) => {
      let current = true;
      untrack(filesPort)
        .agent.listAgents(serverId)
        .then((list) => {
          if (current) setAgents(list.map(toAgentProfile));
        })
        // Without names the cards still show their chats; the storage read reports its own failure.
        .catch(() => undefined);
      return () => {
        current = false;
      };
    },
  );

  function showInChat(file: StoredFileRow): void {
    if (file.agentId && file.messageId) navigation.selectGlobalSearchMessage(file.agentId, file.messageId);
  }

  function act(file: StoredFileRow, action: StoredFileAction): Promise<void> {
    return storage.fileAction(file, action, { onShowInChat: showInChat });
  }

  async function open(file: StoredFileRow, origin: HTMLElement | undefined): Promise<void> {
    if (!canPreviewAttachment(file) || !file.previewUrl) return act(file, "open");
    try {
      const preview = await attachmentFilePreview(file);
      if (preview.previewKind === "none") return act(file, "open");
      setViewing({ file, preview, origin });
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
      <div class="library-panel-content" inert={viewing() !== null}>
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
        />
      </div>
      <Show when={viewing()} keyed>
        {(shown) => <LibraryViewer viewing={shown} agents={agents()} onAction={act} onClose={closeViewer} />}
      </Show>
    </div>
  );
}

/** The file over the Library page, at the full size of the page. Escape or the close button closes it. */
function LibraryViewer(props: {
  viewing: Viewing;
  agents: AgentProfile[];
  onAction: (file: StoredFileRow, action: StoredFileAction) => Promise<void>;
  onClose: () => void;
}) {
  const platform = usePlatform();
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !event.defaultPrevented) props.onClose();
  };
  document.addEventListener("keydown", onKeyDown);
  onCleanup(() => document.removeEventListener("keydown", onKeyDown));
  const file = () => props.viewing.file;
  const available = () => file().status === "available";
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
          onOpenLink={(url) => void appPort().openUrl(url)}
          onOpenSharedFile={() => undefined}
          // A file on a joined server has no copy on this computer to open or show.
          allowExternalOpen={available()}
          onOpenExternally={() => void props.onAction(file(), "open")}
          onDownload={() => void props.onAction(file(), "download")}
          onReveal={available() ? () => void props.onAction(file(), "reveal") : undefined}
          onClose={props.onClose}
        />
      </Loading>
    </section>
  );
}
