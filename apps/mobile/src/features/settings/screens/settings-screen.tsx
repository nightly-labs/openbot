import { router } from "expo-router";
import { Typography } from "heroui-native";
import { mobileUserName } from "@/features/auth/api/mobile-user-name";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { ProfileAvatar } from "@/shared/components/profile-avatar";

export function SettingsScreen() {
  const { session } = useMobileSession();
  const displayName = session ? mobileUserName(session.user) : "Profile";
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
      <SettingsSection title="Preferences">
        <SettingsRow onPress={() => router.push("/settings/general")} supportingText="Appearance and conversations">
          <Typography.Paragraph type="body-sm">General</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection>
        <SettingsRow onPress={() => router.push("/settings/about")}>
          <Typography.Paragraph type="body-sm">About OpenBot</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
    </SettingsContent>
  );
}
