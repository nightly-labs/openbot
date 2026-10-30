import { Button, Copy, Dialog, Download, IconButton, Text, toast, X } from "@openbot/ui";
import { createSignal, onCleanup, Show, untrack } from "solid-js";
import { useText } from "../../text";

/** The page's content security policy refuses `blob:` images, so the preview is a `data:` URL. */
export function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** The activity image: a preview, then a copy to the clipboard or a save to a file. */
export function ProfileShareDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  createImage: () => Promise<Blob>;
}) {
  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay class="ui-confirm-dialog-overlay">
          <Dialog.Content as="section" class="ui-dialog-content profile-dialog">
            <ProfileShareContent createImage={props.createImage} onClose={() => props.onOpenChange(false)} />
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ProfileShareContent(props: { createImage: () => Promise<Blob>; onClose: () => void }) {
  const { t, errorMessage } = useText();
  const [image, setImage] = createSignal<{ blob: Blob; url: string } | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const downloads = new Set<string>();
  let disposed = false;
  onCleanup(() => {
    disposed = true;
    for (const url of downloads) URL.revokeObjectURL(url);
  });

  // One image for each open: a later change to the account or the report does not draw it again.
  void untrack(() => props.createImage())
    .then(async (blob) => {
      const url = await blobDataUrl(blob);
      if (!disposed) setImage({ blob, url });
    })
    .catch((cause: unknown) => {
      if (!disposed) setError(errorMessage(cause, t("settings.profile.share.createFailed")));
    });

  async function copy(blob: Blob) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      toast.success(t("settings.profile.share.copied"));
    } catch (cause) {
      toast.error(errorMessage(cause, t("settings.profile.share.copyFailed")));
    }
  }

  function save(blob: Blob) {
    const url = URL.createObjectURL(blob);
    downloads.add(url);
    const link = document.createElement("a");
    link.href = url;
    link.download = t("settings.profile.share.fileName");
    link.click();
  }

  return (
    <>
      <header class="profile-dialog-header">
        <Dialog.Title as="h2" class="profile-dialog-title">
          {t("settings.profile.share.title")}
        </Dialog.Title>
        <IconButton label={t("common.close")} variant="ghost" onClick={props.onClose}>
          <X />
        </IconButton>
      </header>
      <Show
        when={image()}
        fallback={
          <div class="profile-share-placeholder">
            <Show
              when={error()}
              fallback={
                <Text tone="muted" role="status">
                  {t("settings.profile.activity.loading")}
                </Text>
              }
            >
              {(message) => (
                <Text role="alert" class="settings-modal-error">
                  {message()}
                </Text>
              )}
            </Show>
          </div>
        }
      >
        {(current) => (
          <img class="profile-share-image" src={current().url} alt={t("settings.profile.share.imageAlt")} />
        )}
      </Show>
      <footer class="profile-dialog-footer">
        <Button
          variant="outline"
          disabled={!image()}
          onClick={() => {
            const current = image();
            if (current) void copy(current.blob);
          }}
        >
          <Copy size={16} aria-hidden="true" />
          {t("settings.profile.share.copy")}
        </Button>
        <Button
          disabled={!image()}
          onClick={() => {
            const current = image();
            if (current) save(current.blob);
          }}
        >
          <Download size={16} aria-hidden="true" />
          {t("settings.profile.share.save")}
        </Button>
      </footer>
    </>
  );
}
