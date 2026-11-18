import { MOBILE_ATTACHMENT_BYTES } from "@openbot/team-client/remote-peer";
import { router } from "expo-router";
import { Typography } from "heroui-native";
import EyeOff from "lucide-react-native/icons/eye-off";
import { useState } from "react";
import { useUniwind } from "uniwind";
import { fileLimitText, MOBILE_LARGE_FILE_BYTES } from "@/features/chat/model/large-files";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsSwitch } from "@/features/settings/components/settings-controls";
import { SettingsPictureChoice } from "@/features/settings/components/settings-picture-choice";
import { ComposerPicture, SwipePicture } from "@/features/settings/components/settings-pictures";
import { RowIcon } from "@/features/settings/components/settings-row-icon";
import {
  type ChatSwipeAction,
  saveChatPullPreference,
  saveChatSwipePreference,
  useChatPullPreference,
  useChatSwipePreference,
} from "@/features/settings/model/chat-swipe";
import { saveLargeFilePreference, useLargeFilePreference } from "@/features/settings/model/large-files";
import { useMotionPreferences } from "@/features/settings/model/motion";
import { saveMotionPreference } from "@/features/settings/model/motion-storage";
import { savePhotoQualityPreference, usePhotoQualityPreference } from "@/features/settings/model/photo-quality";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";
import { useText } from "@/shared/lib/text";
import { END_X } from "@/shared/lib/text-direction";

type ConversationSetting = "compactComposer" | "swipe" | "pull" | "largeFiles" | "photoQuality";

function withoutSetting(
  settings: ReadonlySet<ConversationSetting>,
  setting: ConversationSetting,
): ReadonlySet<ConversationSetting> {
  if (!settings.has(setting)) return settings;
  const next = new Set(settings);
  next.delete(setting);
  return next;
}

export function ConversationsSettingsScreen() {
  const text = useText();
  const { t } = text;
  const { theme } = useUniwind();
  const dark = theme === "dark";
  // Each setting keeps its own save error, so a save of one setting does not hide the error of another.
  const [failed, setFailed] = useState<ReadonlySet<ConversationSetting>>(() => new Set());
  function save(setting: ConversationSetting, write: Promise<void>) {
    setFailed((current) => withoutSetting(current, setting));
    void write.catch(() => {
      setFailed((current) => new Set(current).add(setting));
      void haptics.notification("error");
    });
  }
  function footer(setting: ConversationSetting, fallback: string): string {
    return failed.has(setting) ? t("mobile.settings.saveFailed") : fallback;
  }

  const motion = useMotionPreferences();
  // Reduced motion, from the device or from Settings > Animations, keeps the message field full size.
  const reduced = useReducedMotion();
  const chatSwipe = useChatSwipePreference();
  const chatPull = useChatPullPreference();
  const largeFiles = useLargeFilePreference();
  const photoQuality = usePhotoQualityPreference();
  // The swipe goes away from Back: to the left, or to the right in a right-to-left layout.
  const chatSwipeLabel =
    END_X === 1 ? t("mobile.settings.conversations.swipeLeft") : t("mobile.settings.conversations.swipeRight");

  return (
    <SettingsContent>
      <SettingsSection>
        <SettingsRow leading={<RowIcon icon={EyeOff} />} onPress={() => router.push("/settings/hidden-chats")}>
          <Typography.Paragraph>{t("mobile.settings.conversations.hiddenChats")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection
        title={t("mobile.settings.conversations.messageField")}
        footer={footer(
          "compactComposer",
          reduced
            ? t("mobile.settings.conversations.compactComposerReduced")
            : t("mobile.settings.conversations.compactFooter"),
        )}
      >
        <SettingsPictureChoice<boolean>
          label={t("mobile.settings.conversations.messageField")}
          value={motion.composerResize && !reduced}
          disabled={!motion.ready || reduced}
          options={[
            {
              value: true,
              label: t("mobile.settings.conversations.compact"),
              picture: (play) => <ComposerPicture compact play={play} />,
            },
            {
              value: false,
              label: t("mobile.settings.conversations.fullSize"),
              picture: (play) => <ComposerPicture compact={false} play={play} />,
            },
          ]}
          onChange={(compact) => save("compactComposer", saveMotionPreference("composerResize", compact))}
        />
      </SettingsSection>
      <SettingsSection title={chatSwipeLabel} footer={footer("swipe", t("mobile.settings.conversations.swipeFooter"))}>
        <SettingsPictureChoice<ChatSwipeAction>
          label={chatSwipeLabel}
          value={chatSwipe.action}
          disabled={!chatSwipe.ready}
          options={[
            {
              value: "threads",
              label: t("mobile.settings.conversations.swipeThreads"),
              picture: (play) => <SwipePicture target="threads" play={play} />,
            },
            {
              value: "browser",
              label: t("mobile.settings.conversations.swipeBrowser"),
              picture: (play) => <SwipePicture target="browser" play={play} />,
            },
            {
              value: "off",
              label: t("mobile.settings.conversations.swipeOff"),
              picture: (play) => <SwipePicture target="off" play={play} />,
            },
          ]}
          onChange={(next) => save("swipe", saveChatSwipePreference(next))}
        />
      </SettingsSection>
      <SettingsSection footer={footer("pull", t("mobile.settings.conversations.pullInfoFooter"))}>
        <SettingsRow>
          <SettingsSwitch
            value={chatPull.enabled}
            disabled={!chatPull.ready}
            label={t("mobile.settings.conversations.pullInfo")}
            dark={dark}
            onValueChange={(enabled) => save("pull", saveChatPullPreference(enabled))}
          />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection
        title={t("mobile.settings.conversations.media")}
        footer={footer(
          "largeFiles",
          t("mobile.settings.conversations.largeFilesFooter", {
            small: fileLimitText(text, MOBILE_ATTACHMENT_BYTES),
            large: fileLimitText(text, MOBILE_LARGE_FILE_BYTES),
          }),
        )}
      >
        <SettingsRow>
          <SettingsSwitch
            value={largeFiles.automatic}
            disabled={!largeFiles.ready || largeFiles.saving}
            label={t("mobile.settings.conversations.largeFiles")}
            dark={dark}
            onValueChange={(automatic) => save("largeFiles", saveLargeFilePreference(automatic))}
          />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection footer={footer("photoQuality", t("mobile.settings.conversations.fullQualityPhotosFooter"))}>
        <SettingsRow>
          <SettingsSwitch
            value={photoQuality.fullQuality}
            disabled={!photoQuality.ready || photoQuality.saving}
            label={t("mobile.settings.conversations.fullQualityPhotos")}
            dark={dark}
            onValueChange={(fullQuality) => save("photoQuality", savePhotoQualityPreference(fullQuality))}
          />
        </SettingsRow>
      </SettingsSection>
    </SettingsContent>
  );
}
