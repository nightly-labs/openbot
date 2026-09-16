import { playableMediaKind } from "@openbot/contracts/attachment-files";
import { Show } from "solid-js";
import { Button, Dialog } from "../../components/ui";
import { CloseIcon } from "./ConversationIcons";
import { useConversationViewScope } from "./conversation-scope";
import { isMarkdownFileName, MarkdownFilePreview } from "./MarkdownFilePreview";

/** @internal Stable HMR boundary for conversation overlays. */
export function ConversationOverlays() {
  const {
    attachmentAction,
    mediaPreview,
    openExternalMessageUrl,
    openSharedFile,
    openWorkspaceFile,
    props,
    setMediaPreview,
  } = useConversationViewScope();
  return (
    <Dialog.Root open={Boolean(mediaPreview())} onOpenChange={(open) => !open && setMediaPreview(null)}>
      <Show when={mediaPreview()}>
        {(preview) => (
          <Dialog.Portal>
            <Dialog.Overlay class="media-backdrop">
              <Dialog.Content as="section" class="media-modal" data-dialog-surface="unstyled">
                <Dialog.Title class="sr-only">{preview().attachment.name}</Dialog.Title>
                <Button
                  variant="ghost"
                  type="button"
                  class="media-close"
                  aria-label="Close media preview"
                  onClick={() => setMediaPreview(null)}
                >
                  <CloseIcon />
                </Button>
                <Show when={preview().attachment.previewKind === "image"}>
                  <img
                    class="media-image"
                    src={preview().attachment.previewUrl ?? ""}
                    alt={preview().attachment.name}
                  />
                </Show>
                <Show when={preview().attachment.previewKind === "pdf"}>
                  <iframe
                    class="media-document"
                    title={preview().attachment.name}
                    src={preview().attachment.previewUrl ?? ""}
                  />
                </Show>
                {/* Media keeps `previewKind: "none"` on the wire, because the frozen Team API
                    attachment validators accept only image, pdf, text, and none. The MIME type
                    carries the kind instead. */}
                <Show when={playableMediaKind(preview().attachment.mimeType) === "audio"}>
                  <audio class="media-audio" controls src={preview().attachment.previewUrl ?? ""}>
                    <track kind="captions" />
                  </audio>
                </Show>
                <Show when={playableMediaKind(preview().attachment.mimeType) === "video"}>
                  <video class="media-video" controls src={preview().attachment.previewUrl ?? ""}>
                    <track kind="captions" />
                  </video>
                </Show>
                <Show
                  when={preview().attachment.previewKind === "text" && isMarkdownFileName(preview().attachment.name)}
                >
                  <MarkdownFilePreview
                    class="media-markdown-preview"
                    renderedClass="media-markdown message-markdown"
                    sourceClass="media-markdown-source"
                    statusClass="media-text"
                    truncatedClass="media-markdown-truncated"
                    resetKey={preview().attachment.id}
                    body={preview().text ?? ""}
                    loading={preview().loading}
                    error={preview().error}
                    agents={props.agents}
                    onSelectAgent={props.onSelectAgent}
                    onOpenLink={(url) => void openExternalMessageUrl(url)}
                    onOpenSharedFile={openSharedFile}
                    onOpenWorkspaceFile={openWorkspaceFile}
                  />
                </Show>
                <Show
                  when={preview().attachment.previewKind === "text" && !isMarkdownFileName(preview().attachment.name)}
                >
                  <pre class="media-text">{preview().loading ? "Loading…" : (preview().error ?? preview().text)}</pre>
                </Show>
                <div class="media-caption">
                  <span>{preview().attachment.name}</span>
                  <Button
                    variant="outline"
                    type="button"
                    onClick={() => attachmentAction(preview().attachment, "open")}
                  >
                    Open
                  </Button>
                  <Button
                    variant="outline"
                    type="button"
                    onClick={() => attachmentAction(preview().attachment, "download")}
                  >
                    Download
                  </Button>
                  <Button
                    variant="outline"
                    type="button"
                    onClick={() => attachmentAction(preview().attachment, "reveal")}
                  >
                    Show in Finder
                  </Button>
                </div>
              </Dialog.Content>
            </Dialog.Overlay>
          </Dialog.Portal>
        )}
      </Show>
    </Dialog.Root>
  );
}
