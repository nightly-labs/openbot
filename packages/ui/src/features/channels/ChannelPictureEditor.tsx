/**
 * The picture at the top of channel settings, and the editor it opens. It works as the agent avatar
 * editor does: an uploaded image, or an icon and a colour. A choice of icon or colour replaces the
 * image, and Remove takes away only the image. The reset button gives the channel its member faces
 * back.
 */

import type { AvatarHue, AvatarImageInput, ChannelIcon, ChannelMember } from "@openbot/contracts/ipc";
import { Button, IconButton, Input, Pencil, Plus, Popover, RotateCcw, toast } from "@openbot/ui";
import { normalizeAvatarFile } from "@openbot/ui/avatar-image";
import { AVATAR_HUE_CHOICES, avatarHueSwatch } from "@openbot/ui/bloub-avatar";
import { useText } from "@openbot/ui/text";
import { createSignal, For, Show } from "solid-js";
import type { AgentProfile } from "../../data";
import { AVATAR_HUE_LABEL } from "../agents/avatar-hue-label";
import { ChannelAvatar, ChannelIconTile } from "./ChannelAvatar";
import {
  CHANNEL_ICON_NAMES,
  CHANNEL_ICONS,
  type ChannelIconName,
  DEFAULT_CHANNEL_ICON_HUE,
  knownChannelIcon,
} from "./channel-icons";

export interface ChannelPictureEditorProps {
  members: ChannelMember[];
  agents: AgentProfile[];
  icon: ChannelIcon | null | undefined;
  imageUrl: string | null | undefined;
  /** Saves an image, or removes it with null. The caller reports a failure. */
  onSetImage: (image: AvatarImageInput | null) => Promise<unknown>;
  /** Saves an icon and removes the image. */
  onSelectIcon: (icon: ChannelIcon) => Promise<unknown>;
  /** Removes the icon and the image, so the member faces show again. */
  onReset: () => Promise<unknown>;
}

export function ChannelPictureEditor(props: ChannelPictureEditorProps) {
  const { t, errorMessage } = useText();
  const [open, setOpen] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  let fileInput: HTMLInputElement | undefined;
  const icon = () => knownChannelIcon(props.icon);
  const hasImage = () => Boolean(props.imageUrl);
  /* The image hides the icon, so no icon or colour shows as chosen while there is one. */
  const chosenIcon = () => (hasImage() ? null : icon());
  const hue = (): AvatarHue => icon()?.hue ?? DEFAULT_CHANNEL_ICON_HUE;

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File | undefined): Promise<void> {
    if (!file) return;
    await run(async () => {
      try {
        const image = await normalizeAvatarFile(file);
        await props.onSetImage(image);
      } catch (error) {
        toast.error(errorMessage(error, t("agentSettings.avatar.processFailed")));
      } finally {
        if (fileInput) fileInput.value = "";
      }
    });
  }

  function selectIcon(name: ChannelIconName): void {
    void run(() => props.onSelectIcon({ name, hue: hue() }));
  }

  function selectHue(next: AvatarHue): void {
    void run(() => props.onSelectIcon({ name: icon()?.name ?? "star", hue: next }));
  }

  return (
    <div class="agent-settings-avatar-picker">
      <Popover.Root open={open()} placement="bottom" gutter={11} onOpenChange={setOpen}>
        <Popover.Trigger class="channel-picture-trigger" aria-label={t("channel.picture.edit")}>
          <ChannelAvatar
            members={props.members}
            agents={props.agents}
            layout="cluster"
            icon={props.icon}
            imageUrl={props.imageUrl}
          />
          <span class="agent-settings-avatar-badge" aria-hidden="true">
            <Pencil class="agent-settings-avatar-badge-icon" />
          </span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content class="avatar-editor channel-picture-editor">
            <Popover.Title class="sr-only">{t("channel.picture.editor")}</Popover.Title>
            <Input
              ref={(element: HTMLInputElement) => (fileInput = element)}
              class="sr-only"
              type="file"
              aria-label={t("agentSettings.avatar.attachFiles")}
              accept="image/png,image/jpeg,image/gif,image/webp"
              onChange={(event: Event & { currentTarget: HTMLInputElement }) =>
                void upload(event.currentTarget.files?.[0])
              }
            />
            <div class="avatar-editor-heading">
              <span>{t("agentSettings.avatar.image")}</span>
              <div class="avatar-editor-actions">
                <Show when={hasImage()}>
                  <Button
                    variant="outline"
                    type="button"
                    disabled={busy()}
                    onClick={() => void run(() => props.onSetImage(null))}
                  >
                    {t("common.remove")}
                  </Button>
                </Show>
              </div>
            </div>
            <Button
              variant="ghost"
              type="button"
              class={["avatar-image-upload", { "avatar-image-upload-active": hasImage() }]}
              disabled={busy()}
              onClick={() => fileInput?.click()}
            >
              <span class="avatar-image-upload-preview">
                <Show when={props.imageUrl} fallback={<Plus aria-hidden="true" />}>
                  {(url) => <img class="channel-picture channel-picture-image" src={url()} alt="" draggable={false} />}
                </Show>
              </span>
              <span>
                <strong>{uploadLabel(hasImage(), t)}</strong>
                <small>{t("agentSettings.avatar.imageHint")}</small>
              </span>
            </Button>
            <div class="avatar-editor-divider" />
            <div class="avatar-editor-heading">
              <span>{t("channel.picture.icon")}</span>
              <div class="avatar-editor-actions">
                <Show when={hasImage() || icon()}>
                  <IconButton
                    variant="outline"
                    type="button"
                    label={t("channel.picture.reset")}
                    disabled={busy()}
                    onClick={() => void run(props.onReset)}
                  >
                    <RotateCcw aria-hidden="true" />
                  </IconButton>
                </Show>
              </div>
            </div>
            <fieldset class="avatar-face-grid channel-icon-grid" aria-label={t("channel.picture.icons")}>
              <For each={CHANNEL_ICON_NAMES}>
                {(name) => (
                  <Button
                    variant="ghost"
                    type="button"
                    class={[
                      "avatar-face-choice",
                      "channel-icon-choice",
                      { "avatar-choice-selected": chosenIcon()?.name === name },
                    ]}
                    aria-label={t(CHANNEL_ICONS[name].label)}
                    aria-pressed={pressed(chosenIcon()?.name === name)}
                    disabled={busy()}
                    data-cuelume-tap="select"
                    onClick={() => selectIcon(name)}
                  >
                    <ChannelIconTile name={name} hue={hue()} />
                  </Button>
                )}
              </For>
            </fieldset>
            <div class="avatar-editor-divider" />
            <div class="avatar-editor-heading">
              <span>{t("agentSettings.avatar.color")}</span>
            </div>
            <fieldset class="avatar-color-grid channel-icon-color-grid" aria-label={t("channel.picture.colorLabel")}>
              <For each={AVATAR_HUE_CHOICES}>
                {(option) => (
                  <Button
                    variant="ghost"
                    type="button"
                    class={["avatar-color-choice", { "avatar-choice-selected": chosenIcon()?.hue === option.hue }]}
                    aria-label={t("channel.picture.hueColor", { hue: t(AVATAR_HUE_LABEL[option.hue]) })}
                    aria-pressed={pressed(chosenIcon()?.hue === option.hue)}
                    disabled={busy()}
                    data-cuelume-tap="select"
                    onClick={() => selectHue(option.hue)}
                  >
                    <span class="avatar-color-swatch" style={{ background: avatarHueSwatch(option.hue) }} />
                  </Button>
                )}
              </For>
            </fieldset>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

function pressed(value: boolean): "true" | "false" {
  return value ? "true" : "false";
}

function uploadLabel(replace: boolean, t: ReturnType<typeof useText>["t"]): string {
  return replace ? t("agentSettings.avatar.replaceImage") : t("agentSettings.avatar.uploadImage");
}
