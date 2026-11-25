import { attachmentMimeTypeForName, playableMediaKind } from "@openbot/contracts/attachment-files";
import { type AttachmentSummary, canPreviewAttachment } from "@openbot/contracts/ipc";
import {
  AudioLines,
  Button,
  Download,
  ExternalLink,
  Film,
  LabelTooltip,
  LabelTooltipTrigger,
  Play,
  RadialProgress,
  RefreshCw,
  Square,
} from "@openbot/ui";
import { createSignal, For, Match, Show, Switch } from "solid-js";
import { useText } from "../../text";
import { attachmentReferenceTone } from "./AttachmentReference";
import { MediaFilePreview } from "./MediaFilePreview";
import type { VideoStageMenu } from "./VideoStage";

export interface AttachmentMediaSource {
  url(attachmentId: string): string | undefined;
  load(attachment: AttachmentSummary, limit?: "thumbnail" | "generated"): Promise<boolean>;
  thumbnailLimit: number;
  generatedImageLimit: number;
  mediaLimit: number;
}

export type AttachmentDownloadState = { phase: "downloading"; received: number; total: number } | { phase: "failed" };

export interface AttachmentDownloads {
  state(attachmentId: string): AttachmentDownloadState | undefined;
  stop?: ((attachment: AttachmentSummary) => void) | undefined;
  retry(attachment: AttachmentSummary): void;
}

const REMOTE_PREVIEW_URL = /^openbot-remote-attachment:/;

export function AttachmentCards(props: {
  attachments: AttachmentSummary[];
  mediaSource?: AttachmentMediaSource | undefined;
  downloads?: AttachmentDownloads | undefined;
  onPreview: (attachment: AttachmentSummary, origin: HTMLElement) => void;
  onAction: (attachment: AttachmentSummary, action: "open" | "reveal" | "download") => void;
}) {
  const { t, format } = useText();
  const [missing, setMissing] = createSignal<ReadonlySet<string>>(new Set());
  const mediaKind = (attachment: AttachmentSummary) =>
    playableMediaKind(attachment.mimeType || attachmentMimeTypeForName(attachment.name));
  const isMissing = (attachment: AttachmentSummary) => missing().has(attachment.id);
  const markMissing = (attachment: AttachmentSummary) => setMissing((current) => new Set(current).add(attachment.id));
  const [loadingMedia, setLoadingMedia] = createSignal<ReadonlySet<string>>(new Set());
  const [playRequested, setPlayRequested] = createSignal<ReadonlySet<string>>(new Set());
  const started = (attachment: AttachmentSummary) => {
    if (!playRequested().has(attachment.id)) return;
    setPlayRequested((current) => {
      const next = new Set(current);
      next.delete(attachment.id);
      return next;
    });
  };
  const [unplayable, setUnplayable] = createSignal<ReadonlySet<string>>(new Set());
  const markUnplayable = (attachment: AttachmentSummary) =>
    setUnplayable((current) => new Set(current).add(attachment.id));
  const sourceUrl = (attachment: AttachmentSummary) =>
    attachment.previewUrl ? undefined : props.mediaSource?.url(attachment.id);
  const imageUrl = (attachment: AttachmentSummary) => attachment.previewUrl ?? sourceUrl(attachment);
  const canLoadMedia = (attachment: AttachmentSummary) =>
    !attachment.previewUrl &&
    Boolean(mediaKind(attachment)) &&
    props.mediaSource !== undefined &&
    attachment.size <= props.mediaSource.mediaLimit &&
    !sourceUrl(attachment);
  const showsPlayer = (attachment: AttachmentSummary) =>
    !isMissing(attachment) &&
    (Boolean(imageUrl(attachment)) || (mediaKind(attachment) === "video" && canLoadMedia(attachment)));
  const showsVideo = (attachment: AttachmentSummary) =>
    mediaKind(attachment) === "video" && showsPlayer(attachment) && !unplayable().has(attachment.id);
  const download = (attachment: AttachmentSummary) => props.downloads?.state(attachment.id);
  const downloading = (attachment: AttachmentSummary) => {
    const state = download(attachment);
    return state?.phase === "downloading" ? state : undefined;
  };
  const percent = (state: { received: number; total: number }) =>
    state.total > 0 ? Math.min(100, Math.floor((state.received / state.total) * 100)) : 0;
  const status = (attachment: AttachmentSummary) => {
    if (isMissing(attachment)) return t("attachment.notFound");
    const state = download(attachment);
    if (state?.phase === "failed") return t("attachment.downloadFailed");
    if (state?.phase === "downloading")
      return t("attachment.downloadProgress", {
        received: format.fileSizeAmount(state.received, state.total),
        total: format.fileSize(state.total),
      });
    return format.fileSize(attachment.size);
  };
  const mediaPreload = (attachment: AttachmentSummary) => {
    if (mediaKind(attachment) === "video")
      return REMOTE_PREVIEW_URL.test(attachment.previewUrl ?? "") ? "none" : "metadata";
    return attachment.previewUrl ? "none" : "metadata";
  };
  const loadMedia = async (attachment: AttachmentSummary) => {
    const source = props.mediaSource;
    if (!source || loadingMedia().has(attachment.id)) return;
    setLoadingMedia((current) => new Set(current).add(attachment.id));
    try {
      if (await source.load(attachment)) setPlayRequested((current) => new Set(current).add(attachment.id));
      else markUnplayable(attachment);
    } finally {
      setLoadingMedia((current) => {
        const next = new Set(current);
        next.delete(attachment.id);
        return next;
      });
    }
  };

  return (
    <div class="message-attachments">
      <For each={props.attachments}>
        {(attachment) => {
          const source = props.mediaSource;
          if (
            source &&
            !attachment.previewUrl &&
            attachment.previewKind === "image" &&
            attachment.size <= source.thumbnailLimit
          )
            void source.load(attachment);
          let card: HTMLDivElement | undefined;
          const videoMenu = (): VideoStageMenu => {
            const actions = [
              { label: t("common.download"), onSelect: () => props.onAction(attachment, "download") },
              { label: t("attachment.openFile"), onSelect: () => props.onAction(attachment, "open") },
            ];
            if (canPreviewAttachment(attachment) && card) {
              const origin = card;
              actions.unshift({
                label: t("chat.preview.preview"),
                onSelect: () => props.onPreview(attachment, origin),
              });
            }
            return {
              details: [attachment.name, status(attachment)],
              actions,
            };
          };
          const player = () => (
            <MediaFilePreview
              kind={mediaKind(attachment)}
              src={imageUrl(attachment)}
              name={attachment.name}
              class="attachment-media-player"
              preload={mediaPreload(attachment)}
              autoplay={playRequested().has(attachment.id)}
              attachmentId={attachment.id}
              loading={loadingMedia().has(attachment.id)}
              onLoad={() => void loadMedia(attachment)}
              onPlay={() => started(attachment)}
              onError={() => markUnplayable(attachment)}
              menu={videoMenu()}
              onDownload={() => props.onAction(attachment, "download")}
            />
          );
          return (
            <div
              ref={card}
              class="message-attachment"
              data-media={mediaKind(attachment) ?? undefined}
              data-player={showsVideo(attachment) ? "video" : undefined}
              data-status={isMissing(attachment) ? "missing" : undefined}
              data-download={download(attachment)?.phase}
            >
              <Show when={showsVideo(attachment)}>{player()}</Show>
              <Button
                variant="ghost"
                type="button"
                class="attachment-preview-button"
                disabled={isMissing(attachment) || !canPreviewAttachment(attachment)}
                aria-label={t("attachment.preview", { name: attachment.name })}
                data-attachment-id={attachment.id}
                data-cuelume-tap="open"
                onClick={(event) => props.onPreview(attachment, event.currentTarget)}
              >
                <Show
                  when={attachment.previewKind === "image" && imageUrl(attachment) && !isMissing(attachment)}
                  fallback={
                    <span
                      class="attachment-file-visual"
                      data-file-tone={attachmentReferenceTone(attachment.name)}
                      aria-hidden="true"
                    >
                      <Show when={mediaKind(attachment)} fallback={<AttachmentFileIcon />}>
                        <Show when={mediaKind(attachment) === "audio"} fallback={<Film />}>
                          <AudioLines />
                        </Show>
                      </Show>
                    </span>
                  }
                >
                  <span
                    class="attachment-file-visual attachment-file-image"
                    data-file-tone={attachmentReferenceTone(attachment.name)}
                  >
                    <img
                      src={imageUrl(attachment) ?? ""}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      onError={() => {
                        if (attachment.previewUrl) markMissing(attachment);
                      }}
                    />
                  </span>
                </Show>
                <span class="attachment-file-copy">
                  <strong title={attachment.name}>{attachment.name}</strong>
                  <small>{status(attachment)}</small>
                </span>
              </Button>
              <Show when={!isMissing(attachment)}>
                <Show when={canLoadMedia(attachment) && mediaKind(attachment) === "audio"}>
                  <Button
                    variant="ghost"
                    type="button"
                    class="attachment-open-button"
                    aria-label={t("attachment.loadMedia", { name: attachment.name })}
                    disabled={loadingMedia().has(attachment.id)}
                    aria-busy={loadingMedia().has(attachment.id) ? "true" : undefined}
                    onClick={() => void loadMedia(attachment)}
                  >
                    <Play />
                  </Button>
                </Show>
                <Switch
                  fallback={
                    <Button
                      variant="ghost"
                      type="button"
                      class="attachment-open-button"
                      aria-label={t("attachment.download", { name: attachment.name })}
                      onClick={() => props.onAction(attachment, "download")}
                    >
                      <Download />
                    </Button>
                  }
                >
                  <Match when={!props.downloads?.stop && downloading(attachment)}>
                    {(state) => (
                      <span class="attachment-download-progress">
                        <RadialProgress
                          class="attachment-download-ring"
                          value={percent(state())}
                          aria-label={t("attachment.download", { name: attachment.name })}
                        />
                      </span>
                    )}
                  </Match>
                  <Match when={downloading(attachment)}>
                    {(state) => (
                      <Button
                        variant="ghost"
                        type="button"
                        class="attachment-open-button attachment-download-stop"
                        aria-label={t("attachment.stopDownload", {
                          name: attachment.name,
                          percent: String(percent(state())),
                        })}
                        onClick={() => props.downloads?.stop?.(attachment)}
                      >
                        <RadialProgress class="attachment-download-ring" value={percent(state())} aria-hidden="true">
                          <Square />
                        </RadialProgress>
                      </Button>
                    )}
                  </Match>
                  <Match when={download(attachment)?.phase === "failed"}>
                    <Button
                      variant="ghost"
                      type="button"
                      class="attachment-open-button"
                      aria-label={t("attachment.retryDownload", { name: attachment.name })}
                      onClick={() => props.downloads?.retry(attachment)}
                    >
                      <RefreshCw />
                    </Button>
                  </Match>
                </Switch>
                <LabelTooltip content={t("attachment.openFile")}>
                  <LabelTooltipTrigger
                    as={Button}
                    variant="ghost"
                    type="button"
                    class="attachment-open-button"
                    aria-label={t("attachment.open", { name: attachment.name })}
                    disabled={downloading(attachment) !== undefined}
                    onClick={() => props.onAction(attachment, "open")}
                  >
                    <ExternalLink />
                  </LabelTooltipTrigger>
                </LabelTooltip>
              </Show>
              <Show when={showsPlayer(attachment) && !showsVideo(attachment)}>{player()}</Show>
            </div>
          );
        }}
      </For>
    </div>
  );
}

export function fileBadge(attachment: AttachmentSummary): string {
  if (attachment.previewKind === "pdf") return "PDF";
  if (attachment.previewKind === "text") return "TXT";
  return attachment.name.split(".").at(-1)?.slice(0, 4).toUpperCase() || "FILE";
}

function AttachmentFileIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M5.5 2.75h5.75l3.25 3.5v11H5.5z" />
      <path d="M11.25 2.75v3.5h3.25M7.75 10h4.5M7.75 13h4.5" />
    </svg>
  );
}
