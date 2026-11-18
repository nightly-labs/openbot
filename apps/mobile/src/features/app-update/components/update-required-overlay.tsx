import { isBelowMinimumVersion } from "@openbot/contracts/app-minimum-version";
import { Button, Typography } from "heroui-native";
import { useEffect, useState } from "react";
import { AppState, BackHandler, Modal, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FullWindowOverlay } from "react-native-screens";
import { openStorePage } from "@/features/app-update/model/app-update";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { BloubBlock } from "@/shared/components/bloub-stage/bloub-block";
import { useBloubColors } from "@/shared/components/bloub-stage/bloub-look";
import { currentAppVersion, refreshMobileFeatures, useMinimumAppVersion } from "@/shared/lib/mobile-features";
import { isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

/**
 * Covers the app while its store version is below the minimum of the session's account server
 * (plan 011, item 24). Only a confirmed answer shows it; a failed check never blocks.
 */
export function UpdateRequiredOverlay() {
  const { session } = useMobileSession();
  const apiUrl = session?.apiUrl ?? null;
  const minimum = useMinimumAppVersion(apiUrl ?? "");
  const current = currentAppVersion();

  // The features answer carries the minimum. Its shared time limit keeps this to one request with Home.
  useEffect(() => {
    if (!apiUrl) return;
    void refreshMobileFeatures(apiUrl);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshMobileFeatures(apiUrl);
    });
    return () => subscription.remove();
  }, [apiUrl]);

  if (!apiUrl || !current || !minimum || !isBelowMinimumVersion(current, minimum)) return null;
  const content = <UpdateRequiredScreen version={current} minimum={minimum} />;
  if (isIOS) return <FullWindowOverlay>{content}</FullWindowOverlay>;
  return (
    <Modal
      visible
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={() => BackHandler.exitApp()}
    >
      {content}
    </Modal>
  );
}

function UpdateRequiredScreen({ version, minimum }: { version: string; minimum: string }) {
  const { t } = useText();
  const insets = useSafeAreaInsets();
  const { dark } = useBloubColors();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function update() {
    setBusy(true);
    setFailed(false);
    try {
      await openStorePage();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="bg-background" style={StyleSheet.absoluteFill}>
      <BloubBlock edge={insets.top + 160} dimmed={dark} />
      <View
        className="flex-1 items-center justify-center gap-6 px-8"
        style={{ paddingTop: insets.top + 160, paddingBottom: insets.bottom + 24 }}
      >
        <View className="items-center gap-3">
          <Typography.Heading type="h3" align="center" accessibilityRole="header">
            {t("mobile.app.update.requiredTitle")}
          </Typography.Heading>
          <Typography.Paragraph align="center" className="text-text-secondary">
            {t("mobile.app.update.requiredBody", { version, minimum })}
          </Typography.Paragraph>
          {failed ? (
            <Typography.Paragraph align="center" accessibilityLiveRegion="polite" className="text-danger-text">
              {t("mobile.app.update.storeFailed")}
            </Typography.Paragraph>
          ) : null}
        </View>
        <Button variant="primary" className="rounded-full px-8" isDisabled={busy} onPress={() => void update()}>
          <Button.Label>{t("mobile.app.update.install")}</Button.Label>
        </Button>
      </View>
    </View>
  );
}
