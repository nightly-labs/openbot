import { parseTwoStepKey } from "@openbot/contracts/two-step-code";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useThemeColor } from "heroui-native/hooks";
import { QrScanner } from "@/features/auth/components/qr-scanner";
import { useTwoStepSetup } from "@/features/servers/model/vault-two-step";
import { SettingsContent, SettingsNote } from "@/features/settings/components/settings-content";
import { headerTitleFont } from "@/shared/lib/app-font";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

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
        router.replace({ pathname: "/server-settings/vault-two-step-check", params: { serverId } });
      }}
      renderOverlay={(camera) => (
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
