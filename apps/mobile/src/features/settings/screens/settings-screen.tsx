import { router } from "expo-router";
import { Typography } from "heroui-native";
import { mobileUserName } from "@/features/auth/api/mobile-user-name";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { ProfileAvatar } from "@/shared/components/profile-avatar";
import { useMobileFeature } from "@/shared/lib/mobile-features";
import { isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

export function SettingsScreen() {
  const { session } = useMobileSession();
  const { t } = useText();
  // Only an iPhone with the feature on serves device tools, so no other phone has the row.
  const deviceToolsOn = useMobileFeature(session?.apiUrl ?? "", "deviceTools");
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
        <SettingsRow onPress={() => router.push("/settings/appearance")}>
          <Typography.Paragraph>{t("mobile.settings.appearance.title")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow onPress={() => router.push("/settings/animations")}>
          <Typography.Paragraph>{t("mobile.settings.animations.title")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow onPress={() => router.push("/settings/language")}>
          <Typography.Paragraph>{t("mobile.settings.language.title")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow onPress={() => router.push("/settings/haptics")}>
          <Typography.Paragraph>{t("mobile.settings.feedback.haptics")}</Typography.Paragraph>
        </SettingsRow>
        {/* On iOS the screen also has the Live Activities, which exist only there. */}
        <SettingsRow onPress={() => router.push("/settings/notifications")}>
          <Typography.Paragraph>{t("mobile.settings.notifications.title")}</Typography.Paragraph>
        </SettingsRow>
        {isIOS && deviceToolsOn ? (
          <SettingsRow onPress={() => router.push("/settings/device-apps")}>
            <Typography.Paragraph>{t("mobile.deviceApps.title")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
        <SettingsRow onPress={() => router.push("/settings/privacy")}>
          <Typography.Paragraph>{t("mobile.settings.privacy.title")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow onPress={() => router.push("/settings/app-lock")}>
          <Typography.Paragraph>{t("mobile.appLock.title")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title={t("mobile.settings.conversations.title")}>
        <SettingsRow onPress={() => router.push("/settings/hidden-chats")}>
          <Typography.Paragraph>{t("mobile.settings.conversations.hiddenChats")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection>
        <SettingsRow
          onPress={() => router.push("/settings/support")}
          supportingText={t("mobile.settings.home.supportHint")}
        >
          <Typography.Paragraph>{t("mobile.settings.home.support")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow onPress={() => router.push("/settings/about")}>
          <Typography.Paragraph>{t("mobile.settings.home.about")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
    </SettingsContent>
  );
}
