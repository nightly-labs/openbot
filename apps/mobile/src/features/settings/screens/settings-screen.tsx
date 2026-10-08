import { router } from "expo-router";
import { Typography } from "heroui-native";
import { mobileUserName } from "@/features/auth/api/mobile-user-name";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { ProfileAvatar } from "@/shared/components/profile-avatar";
import { isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

export function SettingsScreen() {
  const { session } = useMobileSession();
  const { t } = useText();
  const { activeServer } = useMobileWorkspace();
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
          <Typography.Paragraph type="body-sm">{displayName}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title={t("mobile.settings.home.preferences")}>
        <SettingsRow onPress={() => router.push("/settings/appearance")}>
          <Typography.Paragraph type="body-sm">{t("mobile.settings.appearance.title")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow onPress={() => router.push("/settings/animations")}>
          <Typography.Paragraph type="body-sm">{t("mobile.settings.animations.title")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow onPress={() => router.push("/settings/language")}>
          <Typography.Paragraph type="body-sm">{t("mobile.settings.language.title")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow onPress={() => router.push("/settings/haptics")}>
          <Typography.Paragraph type="body-sm">{t("mobile.settings.feedback.haptics")}</Typography.Paragraph>
        </SettingsRow>
        {/* Live Activities exist only on iOS. */}
        {isIOS ? (
          <SettingsRow onPress={() => router.push("/settings/live-activities")}>
            <Typography.Paragraph type="body-sm">{t("mobile.settings.liveActivities.title")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
        <SettingsRow onPress={() => router.push("/settings/privacy")}>
          <Typography.Paragraph type="body-sm">{t("mobile.settings.privacy.title")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title={t("mobile.settings.conversations.title")}>
        <SettingsRow onPress={() => router.push("/settings/hidden-chats")}>
          <Typography.Paragraph type="body-sm">{t("mobile.settings.conversations.hiddenChats")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow
          onPress={() => router.push({ pathname: "/settings/deleted-chats", params: { serverId: activeServer.id } })}
        >
          <Typography.Paragraph type="body-sm">
            {t("mobile.settings.conversations.deletedChannels")}
          </Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection>
        <SettingsRow
          onPress={() => router.push("/settings/support")}
          supportingText={t("mobile.settings.home.supportHint")}
        >
          <Typography.Paragraph type="body-sm">{t("mobile.settings.home.support")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow onPress={() => router.push("/settings/about")}>
          <Typography.Paragraph type="body-sm">{t("mobile.settings.home.about")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
    </SettingsContent>
  );
}
