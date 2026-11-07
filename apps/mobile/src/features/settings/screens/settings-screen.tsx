import { router } from "expo-router";
import { Typography } from "heroui-native";
import Bell from "lucide-react-native/icons/bell";
import EyeOff from "lucide-react-native/icons/eye-off";
import Info from "lucide-react-native/icons/info";
import Languages from "lucide-react-native/icons/languages";
import Lock from "lucide-react-native/icons/lock";
import MessageCircleQuestionMark from "lucide-react-native/icons/message-circle-question-mark";
import Mic from "lucide-react-native/icons/mic";
import Palette from "lucide-react-native/icons/palette";
import Shield from "lucide-react-native/icons/shield";
import Vibrate from "lucide-react-native/icons/vibrate";
import WandSparkles from "lucide-react-native/icons/wand-sparkles";
import { mobileUserName } from "@/features/auth/api/mobile-user-name";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { RowIcon } from "@/features/settings/components/settings-row-icon";
import { ProfileAvatar } from "@/shared/components/profile-avatar";
import { useText } from "@/shared/lib/text";

export function SettingsScreen() {
  const { session } = useMobileSession();
  const { t } = useText();
  const displayName = session ? mobileUserName(session.user) : t("mobile.settings.home.profile");
  return (
    <SettingsContent>
      <SettingsSection>
        <SettingsRow
          onPress={() => router.push("/settings/profile")}
          supportingText={session?.user.email}
          leading={
            <ProfileAvatar
              neutral
              name={displayName}
              imageUrl={session?.user.avatarUrl ? new URL(session.user.avatarUrl, session.apiUrl).toString() : null}
              size={40}
            />
          }
        >
          <Typography.Paragraph>{displayName}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title={t("mobile.settings.home.preferences")}>
        <SettingsRow leading={<RowIcon icon={Palette} />} onPress={() => router.push("/settings/appearance")}>
          <Typography.Paragraph>{t("mobile.settings.appearance.title")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow leading={<RowIcon icon={WandSparkles} />} onPress={() => router.push("/settings/animations")}>
          <Typography.Paragraph>{t("mobile.settings.animations.title")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow leading={<RowIcon icon={Languages} />} onPress={() => router.push("/settings/language")}>
          <Typography.Paragraph>{t("mobile.settings.language.title")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow leading={<RowIcon icon={Mic} />} onPress={() => router.push("/settings/voice")}>
          <Typography.Paragraph>{t("mobile.settings.voice.title")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow leading={<RowIcon icon={Vibrate} />} onPress={() => router.push("/settings/haptics")}>
          <Typography.Paragraph>{t("mobile.settings.feedback.haptics")}</Typography.Paragraph>
        </SettingsRow>
        {/* On iOS the screen also has the Live Activities, which exist only there. */}
        <SettingsRow leading={<RowIcon icon={Bell} />} onPress={() => router.push("/settings/notifications")}>
          <Typography.Paragraph>{t("mobile.settings.notifications.title")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow leading={<RowIcon icon={Shield} />} onPress={() => router.push("/settings/privacy")}>
          <Typography.Paragraph>{t("mobile.settings.privacy.title")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow leading={<RowIcon icon={Lock} />} onPress={() => router.push("/settings/app-lock")}>
          <Typography.Paragraph>{t("mobile.appLock.title")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title={t("mobile.settings.conversations.title")}>
        <SettingsRow leading={<RowIcon icon={EyeOff} />} onPress={() => router.push("/settings/hidden-chats")}>
          <Typography.Paragraph>{t("mobile.settings.conversations.hiddenChats")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection>
        <SettingsRow
          leading={<RowIcon icon={MessageCircleQuestionMark} />}
          onPress={() => router.push("/settings/support")}
          supportingText={t("mobile.settings.home.supportHint")}
        >
          <Typography.Paragraph>{t("mobile.settings.home.support")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow leading={<RowIcon icon={Info} />} onPress={() => router.push("/settings/about")}>
          <Typography.Paragraph>{t("mobile.settings.home.about")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
    </SettingsContent>
  );
}
