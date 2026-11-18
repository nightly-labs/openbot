import { Image } from "expo-image";
import { router } from "expo-router";
import { Typography } from "heroui-native";
import { useEffect } from "react";
import { View } from "react-native";
import eyesAsset from "@/assets/icons/app-icon.icon/Assets/eyes.png";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { APP_ICON_LABELS, appIconLook, loadAppIcon, useAppIcon } from "@/features/settings/model/app-icon";
import { useText } from "@/shared/lib/text";

/** Opens the app icon picker. Hidden when the phone or the build cannot change the icon. */
export function AppIconSection() {
  const { t } = useText();
  const { value, ready } = useAppIcon();

  useEffect(() => {
    void loadAppIcon().catch(() => undefined);
  }, []);

  if (!ready || value === null) return null;
  const look = appIconLook(value);
  return (
    <SettingsSection>
      <SettingsRow
        value={t(APP_ICON_LABELS[value])}
        onPress={() => router.push("/settings/app-icon")}
        leading={
          <View
            className="size-8 items-center justify-center overflow-hidden rounded-[8px]"
            style={{ backgroundColor: look.body }}
          >
            <Image
              source={eyesAsset}
              style={{ width: 23, height: 11 }}
              tintColor={look.eyes}
              contentFit="contain"
              accessible={false}
            />
          </View>
        }
      >
        <Typography.Paragraph>{t("mobile.settings.appearance.appIcon")}</Typography.Paragraph>
      </SettingsRow>
    </SettingsSection>
  );
}
