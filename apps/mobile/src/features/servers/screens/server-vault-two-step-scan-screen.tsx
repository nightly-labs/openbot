import { parseTwoStepKey } from "@openbot/contracts/two-step-code";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useThemeColor } from "heroui-native/hooks";
import { QrScanner } from "@/features/auth/components/qr-scanner";
import { useTwoStepSetup } from "@/features/servers/model/vault-two-step";
import { SettingsContent, SettingsNote } from "@/features/settings/components/settings-content";
import { headerTitleFont } from "@/shared/lib/app-font";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

/**
 * Setup, step 2 (optional): the camera reads the QR code that the site shows, for example on a
 * computer. It is the scanner of the invite links, so the camera permission, the return from the
 * background and a wrong code work as there. A code with a two-step key goes on to the check step.
 */
export function ServerVaultTwoStepScanScreen() {
  const { t } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const formId = useTwoStepSetup((state) => state.formId);
  const setKeyText = useTwoStepSetup((state) => state.setKeyText);
  const [foreground] = useThemeColor(["foreground"]);
  if (!formId)
    return (
      <SettingsContent>
        <SettingsNote>{t("mobile.server.vault.twoStep.noSetup")}</SettingsNote>
      </SettingsContent>
    );
  return (
    <QrScanner
      embedded
      pairing={false}
      onScan={async (data) => {
        if (!parseTwoStepKey(data)) throw new Error(t("mobile.server.vault.twoStep.qrNoKey"));
        setKeyText(data);
        void haptics.notification("success");
        // The check step takes the place of the camera, so Back from it goes to the key page.
        router.replace({ pathname: "/server-settings/vault-two-step-check", params: { serverId } });
      }}
      renderOverlay={(camera) => (
        // White over the camera; the theme color over the permission page.
        <Stack.Screen
          options={{
            headerTintColor: camera ? "white" : String(foreground),
            headerTitleStyle: { ...headerTitleFont, color: camera ? "white" : String(foreground) },
          }}
        />
      )}
    />
  );
}
