import type { DraftAttachment } from "@openbot/contracts/ipc";
import { ImageRemoveButton, Spinner } from "@openbot/ui";
import { For, Show } from "solid-js";
import { useText } from "../../text";
import { fileBadge } from "./AttachmentCards";
import { attachmentReferenceTone } from "./AttachmentReference";

/** A pasted image that is still importing, with its local preview. */
export interface ComposerPendingImage {
  id: string;
  name: string;
  url: string;
}

/** The files of a message box that its text does not name, and the pasted images that still import. */
export function ComposerAttachmentRow(props: {
  attachments: readonly DraftAttachment[];
  pending?: readonly ComposerPendingImage[] | undefined;
  removeDisabled?: boolean | undefined;
  onRemove: (attachment: DraftAttachment) => void;
}) {
  const { t, format } = useText();
  return (
    <Show when={props.attachments.length > 0 || (props.pending?.length ?? 0) > 0}>
      <div class="composer-attachments">
        <For each={props.attachments}>
          {(attachment) => {
            // An image with no preview (the web client) shows as a file, with its name.
            const chip = () => (attachment.kind === "image" && attachment.previewUrl ? "image" : "file");
            return (
              <div class="composer-attachment ui-removable-image" data-kind={chip()}>
                <span
                  class="composer-attachment-preview"
                  data-file-tone={chip() === "file" ? attachmentReferenceTone(attachment.name) : undefined}
                >
                  <Show when={chip() === "image"} fallback={fileBadge(attachment)}>
                    <img src={attachment.previewUrl ?? ""} alt="" />
                  </Show>
                </span>
                <Show when={chip() === "file"}>
                  <span class="composer-attachment-copy">
                    <strong title={attachment.name}>{attachment.name}</strong>
                    <small>{format.fileSize(attachment.size)}</small>
                  </span>
                </Show>
                <ImageRemoveButton
                  label={t("composer.attachment.remove", { name: attachment.name })}
                  disabled={props.removeDisabled === true}
                  onClick={() => props.onRemove(attachment)}
                />
              </div>
            );
          }}
        </For>
        <For each={props.pending ?? []}>
          {(image) => (
            <div class="composer-attachment" data-kind="image" data-pending="">
              <span class="composer-attachment-preview">
                <img src={image.url} alt="" />
              </span>
              <Spinner size="sm" label={t("composer.attachment.adding", { name: image.name })} />
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}
