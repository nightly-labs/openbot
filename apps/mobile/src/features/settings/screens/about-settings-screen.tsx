import * as Application from "expo-application";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
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
import { useText } from "@/shared/lib/text";

const PRODUCT_NAME = "OpenBot";

export function AboutSettingsScreen() {
  const { t } = useText();
  const version = Constants.expoConfig?.version ?? t("mobile.settings.about.development");
  // The build number of the installed app. EAS sets it at build time, so app.json does not have it.
  const build = Application.nativeBuildVersion;
  // An over-the-air update keeps the version and the build, so its short ID shows after them.
  const update = Updates.isEmbeddedLaunch ? null : Updates.updateId?.slice(0, 8);
  const versionLabel = [build ? `${version} (${build})` : version, ...(update ? [update] : [])].join(" · ");
  const [error, setError] = useState<string | null>(null);
  function open(url: string) {
    setError(null);
    void Linking.openURL(url).catch(() => setError(t("mobile.settings.about.openFailed")));
  }
  return (
    <SettingsContent>
      <SettingsSection title={t("mobile.settings.about.resources")}>
        <SettingsRow onPress={() => open("https://openbot.run")}>
          <Typography.Paragraph>{t("mobile.settings.about.website")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow onPress={() => open("https://openbot.run/privacy-policy")}>
          <Typography.Paragraph>{t("mobile.settings.about.privacy")}</Typography.Paragraph>
        </SettingsRow>
        {error ? <SettingsNote>{error}</SettingsNote> : null}
      </SettingsSection>
      <View className="items-center gap-4 px-4 pb-6 pt-8">
        <AppLogo size={56} interactive />
        <View className="items-center gap-1">
          <Typography.Heading type="h4" align="center">
            {PRODUCT_NAME}
          </Typography.Heading>
          <Typography.Paragraph type="body-xs" align="center" className="text-grouped-secondary" selectable>
            {versionLabel}
          </Typography.Paragraph>
        </View>
      </View>
    </SettingsContent>
  );
}
