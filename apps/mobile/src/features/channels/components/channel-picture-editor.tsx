import { AVATAR_HUE_CHOICES, avatarHueSwatch } from "@openbot/brand/bloub-avatar";
import {
  type AvatarHue,
  CHANNEL_ICON_NAMES,
  type ChannelDraft,
  type ChannelIconName,
  type ChannelSummary,
} from "@openbot/contracts/ipc";
import * as Crypto from "expo-crypto";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import type { LucideIcon } from "lucide-react-native";
import ImagePlus from "lucide-react-native/icons/image-plus";
import RotateCcw from "lucide-react-native/icons/rotate-ccw";
import Trash2 from "lucide-react-native/icons/trash";
import { type ReactNode, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { HUE_LABELS } from "@/features/agents/components/agent-appearance-picker";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { haptics } from "@/shared/lib/haptics";
import { pickAvatarPhoto } from "@/shared/lib/pick-avatar-photo";
import { useText } from "@/shared/lib/text";
import { CHANNEL_ICONS, DEFAULT_CHANNEL_ICON_HUE, knownChannelIcon } from "../model/channel-icons";
import type { MobileChannelStore } from "../model/channel-store";
import { ChannelAvatar, ChannelIconTile } from "./channel-avatar";

const PREVIEW_SIZE = 88;
const ICON_COLUMNS = 5;
const COLOR_COLUMNS = 5;
/** The crop screen shows the rounded square of a channel picture. */
const CROP_CORNER_RATIO = 0.3;

/**
 * The picture of a channel, as the desktop channel settings edit it: an uploaded image, or an icon on
 * a colour. A choice saves at once. An icon replaces the image, and the reset gives the channel its
 * member faces back. The icon is saved first, and the image goes after it, so a failed step does not
 * lose the image.
 */
export function ChannelPictureEditor({
  channel,
  serverId,
  agents,
  store,
  disabled,
}: {
  channel: ChannelSummary;
  serverId: string;
  agents: ReadonlyMap<string, MobileAgent>;
  store: MobileChannelStore;
  disabled: boolean;
}) {
  const { t, errorMessage } = useText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const icon = knownChannelIcon(channel.icon);
  const hasImage = Boolean(channel.imageUrl);
  // The image hides the icon, so no icon or colour shows as chosen while there is one.
  const chosen = hasImage ? null : icon;
  const hue: AvatarHue = icon?.hue ?? DEFAULT_CHANNEL_ICON_HUE;
  const off = disabled || busy;

  async function run(action: () => Promise<unknown>) {
    if (lock.current || disabled) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
      void haptics.notification("success");
    } catch (cause) {
      void haptics.notification("error");
      setError(errorMessage(cause, t("mobile.channel.form.saveFailed")));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  /** Saves the stored draft with another icon. Unsaved edits of the form stay in the form. */
  function saveIcon(next: ChannelDraft["icon"]) {
    return store.command(serverId, {
      type: "save",
      operationId: Crypto.randomUUID(),
      channelId: channel.id,
      update: true,
      draft: {
        name: channel.name,
        title: channel.title,
        instructions: channel.instructions,
        members: channel.members,
        leadAgentId: channel.leadAgentId,
        icon: next,
      },
    });
  }
  const selectIcon = (name: ChannelIconName, nextHue: AvatarHue) =>
    run(async () => {
      await saveIcon({ name, hue: nextHue });
      if (hasImage) await store.setImage(serverId, channel.id, null);
    });
  const reset = () =>
    run(async () => {
      if (channel.icon) await saveIcon(null);
      if (hasImage) await store.setImage(serverId, channel.id, null);
    });
  const choosePhoto = () =>
    run(async () => {
      const photo = await pickAvatarPhoto(
        { pathname: "/channel-info/[channelId]/crop-photo", params: { channelId: channel.id, serverId } },
        CROP_CORNER_RATIO,
      );
      if (!photo) return;
      await store.setImage(serverId, channel.id, { name: photo.name, mimeType: photo.mimeType, base64: photo.base64 });
    });

  return (
    <View className="gap-5">
      <View className="items-center" accessible accessibilityLabel={t("mobile.channel.picture.title")}>
        <ChannelAvatar channel={channel} agents={agents} size={PREVIEW_SIZE} serverId={serverId} />
      </View>
      <PictureSection title={t("mobile.channel.picture.photo")}>
        <View className="flex-row flex-wrap items-center justify-center gap-2 p-2">
          <IconAction
            label={t(hasImage ? "mobile.channel.picture.changePhoto" : "mobile.channel.picture.addPhoto")}
            icon={ImagePlus}
            disabled={off}
            onPress={choosePhoto}
          />
          {hasImage ? (
            <IconAction
              label={t("mobile.channel.picture.removePhoto")}
              icon={Trash2}
              disabled={off}
              onPress={() => run(() => store.setImage(serverId, channel.id, null))}
            />
          ) : null}
        </View>
      </PictureSection>
      <PictureSection
        title={t("mobile.channel.picture.icon")}
        action={
          hasImage || icon ? (
            <IconAction
              label={t("mobile.channel.picture.reset")}
              icon={RotateCcw}
              disabled={off}
              onPress={reset}
              small
            />
          ) : null
        }
      >
        <View
          className="flex-row flex-wrap"
          accessibilityRole="radiogroup"
          accessibilityLabel={t("mobile.channel.picture.icon")}
        >
          {CHANNEL_ICON_NAMES.map((name) => (
            <ChoiceCell
              key={name}
              columns={ICON_COLUMNS}
              label={t(CHANNEL_ICONS[name].label)}
              checked={chosen?.name === name}
              disabled={off}
              onPress={() => void selectIcon(name, hue)}
            >
              <ChannelIconTile name={name} hue={hue} size={36} />
            </ChoiceCell>
          ))}
        </View>
      </PictureSection>
      <PictureSection title={t("mobile.channel.picture.color")}>
        <View
          className="flex-row flex-wrap"
          accessibilityRole="radiogroup"
          accessibilityLabel={t("mobile.channel.picture.color")}
        >
          {AVATAR_HUE_CHOICES.map((option) => (
            <ChoiceCell
              key={option.hue}
              columns={COLOR_COLUMNS}
              label={t(HUE_LABELS[option.hue])}
              checked={chosen?.hue === option.hue}
              disabled={off}
              onPress={() => void selectIcon(icon?.name ?? "star", option.hue)}
            >
              <View className="size-7 rounded-full" style={{ backgroundColor: avatarHueSwatch(option.hue) }} />
            </ChoiceCell>
          ))}
        </View>
      </PictureSection>
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">
          {error}
        </Typography.Paragraph>
      ) : null}
    </View>
  );
}

/** A group of the editor, as the groups of the agent appearance editor. */
function PictureSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <View className="gap-2">
      <View className="min-h-8 flex-row items-center justify-between gap-2 px-4">
        <Typography type="body-xs" className="text-grouped-secondary">
          {title}
        </Typography>
        {action}
      </View>
      <View className="overflow-hidden rounded-grouped bg-grouped p-2">{children}</View>
    </View>
  );
}

function IconAction({
  label,
  icon: Icon,
  disabled,
  onPress,
  small = false,
}: {
  label: string;
  icon: LucideIcon;
  disabled: boolean;
  onPress: () => void;
  small?: boolean;
}) {
  const color = useThemeColor(small ? "muted" : "foreground");
  return (
    <Button
      isIconOnly
      {...(small ? { size: "sm" as const } : {})}
      variant="ghost"
      accessibilityLabel={label}
      isDisabled={disabled}
      onPress={() => {
        void haptics.impact("soft");
        onPress();
      }}
    >
      <Icon color={String(color)} size={small ? 18 : 20} />
    </Button>
  );
}

/** One choice of a grid. The chosen one has a light fill that shows on the grouped card in both themes. */
function ChoiceCell({
  columns,
  label,
  checked,
  disabled,
  onPress,
  children,
}: {
  columns: number;
  label: string;
  checked: boolean;
  disabled: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      style={{ width: `${100 / columns}%` as const }}
      className="aspect-square p-0.5"
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={() => {
        if (checked) return;
        void haptics.selection();
        onPress();
      }}
    >
      {({ pressed }) => (
        <View
          className={`flex-1 items-center justify-center rounded-xl ${checked ? "bg-foreground/10" : ""}`}
          style={{ opacity: pressed && !checked ? 0.6 : disabled ? 0.5 : 1 }}
        >
          {children}
        </View>
      )}
    </Pressable>
  );
}
