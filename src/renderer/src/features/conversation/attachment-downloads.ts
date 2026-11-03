import type {
  AttachmentDownloadProgress,
  AttachmentSummary,
  FileAction,
  OpenAttachmentInput,
} from "@openbot/contracts/ipc";
import type { AttachmentDownloadState, AttachmentDownloads } from "@openbot/ui/features/conversation/AttachmentCards";
import { createStore, onCleanup } from "solid-js";

/** The bridge calls of attachment downloads. Without `stop` and `subscribe`, a card shows no download state. */
export interface AttachmentDownloadCalls {
  open(input: OpenAttachmentInput): Promise<void>;
  stop?: ((attachmentId: string) => Promise<void>) | undefined;
  subscribe?: ((listener: (progress: AttachmentDownloadProgress) => void) => () => void) | undefined;
}

interface TrackedDownload {
  state: AttachmentDownloadState;
  /** The action that the retry repeats. */
  action: FileAction;
}

const LOCAL_SERVER_ID = "local";

function downloadKey(serverId: string, attachmentId: string): string {
  return JSON.stringify([serverId, attachmentId]);
}

/**
 * Opens attachments and keeps the download state of each one from a joined server. A local file needs
 * no download, so it gets no state. The owner reports a failure; the card also shows it.
 */
export function createAttachmentDownloads(options: {
  serverId: () => string;
  calls: () => AttachmentDownloadCalls;
  onError: (error: unknown) => void;
}): { downloads: AttachmentDownloads; open(attachment: AttachmentSummary, action: FileAction): void } {
  const [tracked, setTracked] = createStore<Record<string, TrackedDownload>>({});
  const unsubscribe = options.calls().subscribe?.((progress) => {
    const key = downloadKey(progress.serverId, progress.attachmentId);
    setTracked((draft) => {
      const state = draft[key]?.state;
      // The cache also loads previews and other clicks of the same file; only a click shows progress.
      if (state?.phase !== "downloading") return;
      state.received = progress.received;
      state.total = progress.total;
    });
  });
  onCleanup(() => unsubscribe?.());

  function open(attachment: AttachmentSummary, action: FileAction): void {
    const serverId = options.serverId();
    const calls = options.calls();
    const shows = serverId !== LOCAL_SERVER_ID && calls.stop !== undefined;
    const key = downloadKey(serverId, attachment.id);
    if (shows) {
      // The running download delivers the file; a second click does not start another.
      if (tracked[key]?.state.phase === "downloading") return;
      setTracked((draft) => {
        draft[key] = { action, state: { phase: "downloading", received: 0, total: attachment.size } };
      });
    }
    calls.open({ attachmentId: attachment.id, action, ...(shows ? { size: attachment.size } : {}) }).then(
      () => {
        if (!shows) return;
        setTracked((draft) => {
          delete draft[key];
        });
      },
      (error: unknown) => {
        if (shows)
          setTracked((draft) => {
            const entry = draft[key];
            if (entry) entry.state = { phase: "failed" };
            else draft[key] = { action, state: { phase: "failed" } };
          });
        options.onError(error);
      },
    );
  }

  const downloads: AttachmentDownloads = {
    state: (attachmentId) => tracked[downloadKey(options.serverId(), attachmentId)]?.state,
    stop: (attachment) => {
      void options
        .calls()
        .stop?.(attachment.id)
        .catch((error: unknown) => options.onError(error));
    },
    retry: (attachment) =>
      open(attachment, tracked[downloadKey(options.serverId(), attachment.id)]?.action ?? "download"),
  };

  return { downloads, open };
}
