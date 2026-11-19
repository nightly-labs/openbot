import type {
  AttachmentDownloadProgress,
  AttachmentSummary,
  FileAction,
  OpenAttachmentInput,
} from "@openbot/contracts/ipc";
import type { AttachmentDownloadState, AttachmentDownloads } from "@openbot/ui/features/conversation/AttachmentCards";
import { createStore, onCleanup } from "solid-js";

export interface AttachmentDownloadCalls {
  open(input: OpenAttachmentInput): Promise<void>;
  stop?: ((attachmentId: string) => Promise<void>) | undefined;
  subscribe?: ((listener: (progress: AttachmentDownloadProgress) => void) => () => void) | undefined;
}

interface TrackedDownload {
  state: AttachmentDownloadState;
  action: FileAction;
}

const LOCAL_SERVER_ID = "local";

function downloadKey(serverId: string, attachmentId: string): string {
  return JSON.stringify([serverId, attachmentId]);
}

export function createAttachmentDownloads<Target>(options: {
  serverId: () => string;
  calls: () => AttachmentDownloadCalls;
  target: () => Target;
  onError: (error: unknown, target: Target) => void;
}): { downloads: AttachmentDownloads; open(attachment: AttachmentSummary, action: FileAction): void } {
  const [tracked, setTracked] = createStore<Record<string, TrackedDownload>>({});
  const unsubscribe = options.calls().subscribe?.((progress) => {
    const key = downloadKey(progress.serverId, progress.attachmentId);
    setTracked((draft) => {
      const state = draft[key]?.state;
      if (state?.phase !== "downloading") return;
      state.received = progress.received;
      state.total = progress.total;
    });
  });
  onCleanup(() => unsubscribe?.());

  function open(attachment: AttachmentSummary, action: FileAction): void {
    const serverId = options.serverId();
    const calls = options.calls();
    const target = options.target();
    const key = downloadKey(serverId, attachment.id);
    const running = tracked[key];
    if (running?.state.phase === "downloading" && running.action === action) return;
    const shows = serverId !== LOCAL_SERVER_ID && calls.stop !== undefined && running?.state.phase !== "downloading";
    if (shows) {
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
        options.onError(error, target);
      },
    );
  }

  const downloads: AttachmentDownloads = {
    state: (attachmentId) => tracked[downloadKey(options.serverId(), attachmentId)]?.state,
    stop: (attachment) => {
      void options
        .calls()
        .stop?.(attachment.id)
        .catch((error: unknown) => options.onError(error, options.target()));
    },
    retry: (attachment) =>
      open(attachment, tracked[downloadKey(options.serverId(), attachment.id)]?.action ?? "download"),
  };

  return { downloads, open };
}
