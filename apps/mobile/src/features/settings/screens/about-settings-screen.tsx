import Constants from "expo-constants";
import { Typography } from "heroui-native";
import { useState } from "react";
import { Linking, View } from "react-native";
import { AppLogo } from "@/features/auth/components/app-logo";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { isAndroid, isIOS } from "@/shared/lib/platform";

export function AboutSettingsScreen() {
  const version = Constants.expoConfig?.version ?? "Development";
  const build = isIOS
    ? Constants.platform?.ios?.buildNumber
    : isAndroid
      ? Constants.platform?.android?.versionCode
      : undefined;
  const versionLabel = build != null ? `${version} (${build})` : version;
  const [error, setError] = useState<string | null>(null);
  function open(url: string) {
    setError(null);
    void Linking.openURL(url).catch(() => setError("Could not open the link. Try again."));
  }
  return (
    <SettingsContent>
      <SettingsSection title="Resources">
        <SettingsRow onPress={() => open("https://openbot.run")}>
          <Typography.Paragraph type="body-sm">Website</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow onPress={() => open("https://github.com/NorbertBodziony/openbot/blob/main/PRIVACY.md")}>
          <Typography.Paragraph type="body-sm">Privacy policy</Typography.Paragraph>
        </SettingsRow>
        {error ? <SettingsNote>{error}</SettingsNote> : null}
      </SettingsSection>
      <View className="items-center gap-4 px-4 pb-6 pt-8">
        <AppLogo size={56} interactive />
        <View className="items-center gap-1">
          <Typography.Heading type="h4" align="center">
            OpenBot
          </Typography.Heading>
          <Typography.Paragraph type="body-xs" align="center" className="text-grouped-secondary" selectable>
            {versionLabel}
          </Typography.Paragraph>
        </View>
      </View>
    </SettingsContent>
  );
}
