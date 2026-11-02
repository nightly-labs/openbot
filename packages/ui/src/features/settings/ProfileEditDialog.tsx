import type { AvatarImageInput, CentralAuthUser } from "@openbot/contracts/ipc";
import { Button, Dialog, Field, IconButton, ImageRemoveButton, Input, Pencil, Text, UserAvatar, X } from "@openbot/ui";
import { createSignal, Show } from "solid-js";
import { useText } from "../../text";
import { blobDataUrl } from "./ProfileShareDialog";
import type { SettingsProfileStore } from "./stores/profile-store";

/** A new photo, or `null` to remove the photo. `undefined` keeps the saved photo. */
interface PhotoDraft {
  image: AvatarImageInput | null;
  url: string | null;
}

/**
 * The photo and the display name, saved together. The caller resets the store's name draft and
 * photo error before it opens the dialog, so each open starts again from the saved profile.
 */
export function ProfileEditDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  store: SettingsProfileStore;
  account: CentralAuthUser;
}) {
  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay class="ui-confirm-dialog-overlay">
          <Dialog.Content as="section" class="ui-dialog-content profile-dialog profile-edit">
            <ProfileEditForm store={props.store} account={props.account} onClose={() => props.onOpenChange(false)} />
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ProfileEditForm(props: { store: SettingsProfileStore; account: CentralAuthUser; onClose: () => void }) {
  const { t, errorMessage } = useText();
  const [photo, setPhoto] = createSignal<PhotoDraft | undefined>();
  const [photoBusy, setPhotoBusy] = createSignal(false);
  const [photoError, setPhotoError] = createSignal<string | null>(null);
  let photoInput: HTMLInputElement | undefined;

  const preview = () => {
    const draft = photo();
    return draft === undefined ? props.account : { ...props.account, avatarUrl: draft.url };
  };
  const busy = () => photoBusy() || props.store.state.avatar.busy || props.store.state.profile.busy;

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      const image = await props.store.processAvatarFile(file);
      setPhoto({ image, url: await blobDataUrl(new Blob([image.bytes.slice()], { type: image.mimeType })) });
    } catch (cause) {
      setPhotoError(errorMessage(cause, t("settings.profile.photo.processFailed")));
    } finally {
      setPhotoBusy(false);
      if (photoInput) photoInput.value = "";
    }
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (busy()) return;
    // The name saves first: a new photo refreshes the account, and the refresh resets the name draft.
    await props.store.saveName();
    if (props.store.visibleNameError()) return;
    const draft = photo();
    if (draft !== undefined) {
      await props.store.updateAvatar(draft.image);
      if (props.store.state.avatar.error) return;
      setPhoto(undefined);
    }
    props.onClose();
  }

  return (
    <form class="profile-edit-form" onSubmit={(event) => void save(event)} novalidate>
      <header class="profile-dialog-header">
        <Dialog.Title as="h2" class="profile-dialog-title">
          {t("settings.profile.edit.title")}
        </Dialog.Title>
        <IconButton label={t("common.close")} variant="ghost" onClick={props.onClose}>
          <X />
        </IconButton>
      </header>
      <div class="profile-edit-photo">
        <div class="settings-identity-image-picker ui-removable-image">
          <Button
            type="button"
            variant="outline"
            size="icon-lg"
            class="settings-identity-image-trigger settings-modal-profile-photo-trigger profile-edit-photo-trigger"
            aria-label={preview().avatarUrl ? t("settings.profile.photo.edit") : t("settings.profile.photo.add")}
            disabled={busy()}
            onClick={() => photoInput?.click()}
          >
            <UserAvatar user={preview()} class="settings-modal-avatar profile-edit-avatar" decorative />
            <span class="profile-edit-photo-badge" aria-hidden="true">
              <Pencil />
            </span>
          </Button>
          <Show when={preview().avatarUrl && !busy()}>
            <ImageRemoveButton
              label={t("settings.profile.photo.remove")}
              onClick={() => setPhoto({ image: null, url: null })}
            />
          </Show>
        </div>
        <Show when={photoError() ?? props.store.state.avatar.error}>
          {(message) => (
            <Text role="alert" class="settings-modal-error">
              {message()}
            </Text>
          )}
        </Show>
        <Input
          ref={(element) => {
            photoInput = element;
          }}
          class="sr-only"
          type="file"
          aria-label={t("settings.profile.photo.upload")}
          accept="image/png,image/jpeg,image/gif,image/webp"
          onChange={(event) => void pickPhoto(event.currentTarget.files?.[0])}
        />
      </div>
      <Field
        label={t("settings.profile.name.title")}
        description={t("settings.profile.name.description")}
        error={props.store.visibleNameError() ?? undefined}
      >
        <Input
          ref={(element) => props.store.registerNameInput(element)}
          value={props.store.state.profile.name}
          autocomplete="name"
          onValueChange={props.store.updateName}
          onBlur={props.store.markTouchedIfDirty}
        />
      </Field>
      <footer class="profile-dialog-footer">
        <Button type="button" variant="ghost" onClick={props.onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={busy()}>
          {busy() ? t("common.saving") : t("common.save")}
        </Button>
      </footer>
    </form>
  );
}
