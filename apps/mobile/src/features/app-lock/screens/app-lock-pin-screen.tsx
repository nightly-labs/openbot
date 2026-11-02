import { router } from "expo-router";
import { Typography } from "heroui-native";
import { useState } from "react";
import { View } from "react-native";
import { PinDots, PinPad } from "@/features/app-lock/components/pin-pad";
import { confirmOwner, saveAppLockPin } from "@/features/app-lock/model/app-lock";
import { PIN_LENGTH } from "@/features/app-lock/model/app-lock-storage";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

/** Sets a new PIN: the user enters it twice. */
export function AppLockPinScreen() {
  const { t } = useText();
  const [first, setFirst] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function complete(value: string) {
    if (first === null) {
      setFirst(value);
      setPin("");
      return;
    }
    if (value !== first) {
      setFirst(null);
      setPin("");
      setError(t("mobile.appLock.pinSetup.mismatch"));
      void haptics.notification("error");
      return;
    }
    setBusy(true);
    try {
      // The confirmation from the app lock screen can be old when the user waited here.
      if (!(await confirmOwner())) return;
      await saveAppLockPin(value);
      void haptics.notification("success");
      router.back();
    } catch {
      setFirst(null);
      setPin("");
      setError(t("mobile.appLock.pinSetup.saveFailed"));
      void haptics.notification("error");
    } finally {
      setBusy(false);
    }
  }

  function addDigit(digit: string) {
    if (busy || pin.length >= PIN_LENGTH) return;
    const next = pin + digit;
    setPin(next);
    if (next.length < PIN_LENGTH) return;
    setError(null);
    void complete(next);
  }

  return (
    <View className="flex-1 items-center justify-center gap-8 pb-safe-offset-4">
      <View className="items-center gap-3 px-8">
        <Typography.Heading type="h4" align="center" accessibilityRole="header">
          {first === null ? t("mobile.appLock.pinSetup.enter") : t("mobile.appLock.pinSetup.confirm")}
        </Typography.Heading>
        <View className="min-h-10">
          {error ? (
            <Typography.Paragraph
              type="body-sm"
              align="center"
              accessibilityLiveRegion="polite"
              className="text-danger-text"
            >
              {error}
            </Typography.Paragraph>
          ) : null}
        </View>
      </View>
      <PinDots count={pin.length} />
      <PinPad
        disabled={busy}
        canDelete={pin.length > 0}
        onDigit={addDigit}
        onDelete={() => setPin((current) => current.slice(0, -1))}
      />
    </View>
  );
}
