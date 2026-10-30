import { usePathname } from "expo-router";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Fingerprint from "lucide-react-native/icons/fingerprint-pattern";
import LockKeyhole from "lucide-react-native/icons/lock-keyhole";
import ScanFace from "lucide-react-native/icons/scan-face";
import { type ReactNode, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Alert, AppState, BackHandler, Modal, StyleSheet, useWindowDimensions, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { FadeIn } from "react-native-reanimated";
import { type EdgeInsets, useSafeAreaInsets } from "react-native-safe-area-context";
import { FullWindowOverlay } from "react-native-screens";
import { PinDots, PinPad } from "@/features/app-lock/components/pin-pad";
import {
  cancelOwnerConfirmation,
  forgetAppLockAndSignOut,
  MAX_PIN_FAILURES,
  pinBlockedUntil,
  retryAppLockLoad,
  unlockAfterSignIn,
  unlockWithDevice,
  unlockWithPin,
  useAppLock,
} from "@/features/app-lock/model/app-lock";
import { appLockEnabled, PIN_LENGTH } from "@/features/app-lock/model/app-lock-storage";
import { type DeviceUnlockKind, deviceUnlockKind } from "@/features/app-lock/model/device-unlock";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { BloubBlock } from "@/shared/components/bloub-stage/bloub-block";
import { useBloubColors } from "@/shared/components/bloub-stage/bloub-look";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";
import { isIOS } from "@/shared/lib/platform";
import { type MobileText, useText } from "@/shared/lib/text";

/** The attempts left are shown when this many or fewer remain. */
const SHOW_ATTEMPTS_LEFT = 5;
// After unlock, the block rolls up and the app shows under it.
const LOCK_EXIT_MS = 560;
// The lock content comes in once the block has made room for it.
const LOCK_ENTER_DELAY_MS = 320;
// The header on the lock screen: never under the status bar alone, never more than this share.
const MIN_LOCK_HEADER = 96;
const MAX_LOCK_HEADER_SHARE = 0.42;

export function deviceUnlockName(kind: DeviceUnlockKind | null, t: MobileText["t"]): string {
  if (kind === "faceId") return t("mobile.appLock.method.faceId");
  if (kind === "touchId") return t("mobile.appLock.method.touchId");
  return t("mobile.appLock.method.phone");
}

function subscribeAppState(onChange: () => void): () => void {
  const subscription = AppState.addEventListener("change", onChange);
  return () => subscription.remove();
}

/** Only the active state. `useAppForeground` also counts `inactive` and `unknown`, and a start in the background can report them. */
function isAppActive(): boolean {
  return AppState.currentState === "active";
}

function DeviceUnlockIcon({ kind, size, color }: { kind: DeviceUnlockKind | null; size: number; color: string }) {
  if (kind === "faceId") return <ScanFace size={size} color={color} strokeWidth={1.75} />;
  if (kind === "touchId") return <Fingerprint size={size} color={color} strokeWidth={1.75} />;
  return <LockKeyhole size={size} color={color} strokeWidth={1.75} />;
}

/**
 * Covers the app while it is locked, and while it is not active so the app switcher shows no chat.
 * iOS draws it in a window layer above the sheets; Android draws it in a dialog window.
 */
export function AppLockOverlay() {
  const { loading, session } = useMobileSession();
  const status = useAppLock((state) => state.status);
  const enabled = useAppLock((state) => appLockEnabled(state.config));
  const locked = useAppLock((state) => state.locked);
  const covered = useAppLock((state) => state.covered);
  const confirming = useAppLock((state) => state.confirming);
  const pathname = usePathname();
  const reduced = useReducedMotion();
  // In dark mode the lock dims the block, as the loader does: it shows each time the app opens.
  const { dark } = useBloubColors();
  const [header, setHeader] = useState<number | null>(null);

  // A new sign-in proves who the user is, so it does not ask for the lock again.
  const signedOut = useRef(false);
  useEffect(() => {
    if (loading) return;
    if (!session) {
      signedOut.current = true;
      return;
    }
    if (signedOut.current) {
      signedOut.current = false;
      unlockAfterSignIn();
    }
  }, [loading, session]);

  const showLock = Boolean(session) && (status === "failed" || (status === "ready" && enabled && locked));
  const showCover = Boolean(session) && (status === "loading" || (enabled && covered));
  const mode = showLock ? "lock" : showCover ? "cover" : null;
  // An unlock keeps the lock on screen a moment longer, so the block can roll up over the app.
  const [shownMode, setShownMode] = useState(mode);
  const [leaving, setLeaving] = useState(false);
  if (shownMode !== mode) {
    setShownMode(mode);
    // Only iOS plays the exit. The Android dialog is its own window: it would hold touches and the
    // Back button for the whole exit.
    setLeaving(isIOS && shownMode === "lock" && mode === null && Boolean(session) && !reduced);
  }
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setLeaving(false), LOCK_EXIT_MS);
    return () => clearTimeout(timer);
  }, [leaving]);

  if (!session || (mode === null && !leaving)) return null;
  const lockShown = mode === "lock" || leaving;
  // The privacy cover fills the screen, as the splash does; the lock moves the block up to a header.
  const edge = leaving ? "gone" : mode === "lock" && header !== null ? header : "cover";

  const content = (
    <GestureHandlerRootView style={StyleSheet.absoluteFill} pointerEvents={leaving ? "none" : "auto"}>
      <Animated.View
        className="bg-background"
        style={[
          StyleSheet.absoluteFill,
          { opacity: leaving ? 0 : 1, transitionProperty: "opacity", transitionDuration: leaving ? 280 : 0 },
        ]}
      />
      <BloubBlock edge={edge} dimmed={dark} />
      {lockShown ? <LockScreen leaving={leaving} onHeaderLayout={setHeader} /> : null}
    </GestureHandlerRootView>
  );

  if (isIOS) {
    // A sheet that opens while the app is locked goes above this layer. A new key adds the layer
    // again, on top of it.
    return <FullWindowOverlay key={lockShown ? pathname : "cover"}>{content}</FullWindowOverlay>;
  }
  return (
    <Modal
      visible
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={() => {
        if (confirming) cancelOwnerConfirmation();
        else BackHandler.exitApp();
      }}
    >
      {content}
    </Modal>
  );
}

function LockScreen({ leaving, onHeaderLayout }: { leaving: boolean; onHeaderLayout: (bottom: number) => void }) {
  const { t } = useText();
  const insets = useSafeAreaInsets();
  const foreground = useThemeColor("foreground");
  const buttonForeground = useThemeColor("default-foreground");
  const { signOut } = useMobileSession();
  const status = useAppLock((state) => state.status);
  const config = useAppLock((state) => state.config);
  const confirming = useAppLock((state) => state.confirming);
  const lockCount = useAppLock((state) => state.lockCount);
  const attempts = useAppLock((state) => state.attempts);
  const appActive = useSyncExternalStore(subscribeAppState, isAppActive, isAppActive);
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<DeviceUnlockKind | null>(null);
  const [now, setNow] = useState(Date.now);
  const method = deviceUnlockName(kind, t);

  useEffect(() => {
    if (!config.deviceUnlock) return;
    let active = true;
    void deviceUnlockKind().then((next) => {
      if (active) setKind(next);
    });
    return () => {
      active = false;
    };
  }, [config.deviceUnlock]);

  const blockedUntil = pinBlockedUntil(attempts, now);
  // The model enforces the wait. This only updates the text each second.
  useEffect(() => {
    if (blockedUntil === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [blockedUntil]);

  const signOutNow = useCallback(
    async (afterTooManyAttempts: boolean) => {
      setBusy(true);
      try {
        await forgetAppLockAndSignOut(signOut);
        if (afterTooManyAttempts) Alert.alert(t("mobile.appLock.lock.signedOut"));
      } catch {
        setMessage(t("mobile.auth.error.signOutUnconfirmed"));
        void haptics.notification("error");
      } finally {
        setBusy(false);
      }
    },
    [signOut, t],
  );

  const confirmSignOut = () =>
    Alert.alert(t("mobile.appLock.lock.signOutTitle"), t("mobile.appLock.lock.signOutBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("mobile.appLock.lock.signOut"), style: "destructive", onPress: () => void signOutNow(false) },
    ]);

  const promptDevice = useCallback(async () => {
    setMessage(null);
    const result = await unlockWithDevice(t("mobile.appLock.lock.unlockPrompt"), t("common.cancel"));
    if (result === "unavailable") setMessage(t("mobile.appLock.device.unavailable"));
    else if (result === "failed") setMessage(t("mobile.appLock.device.failed", { method }));
  }, [method, t]);

  // Offer Face ID once for each lock, when the app is active. iOS can start the app while the phone is
  // locked, and that start locks the app. A prompt then would wake the phone.
  const prompted = useRef(-1);
  useEffect(() => {
    if (!appActive || status !== "ready" || !config.deviceUnlock || prompted.current === lockCount) return;
    prompted.current = lockCount;
    void promptDevice();
  }, [appActive, config.deviceUnlock, lockCount, promptDevice, status]);

  async function submit(value: string) {
    setBusy(true);
    try {
      const result = await unlockWithPin(value);
      setPin("");
      if (result === "unlocked") {
        void haptics.notification("success");
        return;
      }
      void haptics.notification("error");
      if (result === "wrong") {
        const left = MAX_PIN_FAILURES - useAppLock.getState().attempts.failures;
        setMessage(
          left <= SHOW_ATTEMPTS_LEFT
            ? t("mobile.appLock.lock.attemptsLeft", { count: left })
            : t("mobile.appLock.lock.wrongPin"),
        );
      } else if (result === "tooManyAttempts") {
        await signOutNow(true);
      } else if (result === "unavailable") {
        setMessage(t("mobile.appLock.lock.pinMissing"));
      } else if (result === "failed") {
        setMessage(t("mobile.appLock.lock.checkFailed"));
      } else {
        setMessage(null);
      }
    } finally {
      setBusy(false);
    }
  }

  function addDigit(digit: string) {
    if (busy || pin.length >= PIN_LENGTH) return;
    const next = pin + digit;
    setPin(next);
    if (next.length === PIN_LENGTH) void submit(next);
  }

  let waitText: string | null = null;
  if (blockedUntil !== null) {
    const seconds = Math.ceil((blockedUntil - now) / 1000);
    waitText =
      seconds > 90
        ? t("mobile.appLock.lock.waitMinutes", { count: Math.ceil(seconds / 60) })
        : t("mobile.appLock.lock.waitSeconds", { count: seconds });
  }

  if (status === "failed") {
    return (
      <LockLayout
        insets={insets}
        leaving={leaving}
        onHeaderLayout={onHeaderLayout}
        title={t("mobile.appLock.lock.title")}
        message={t("mobile.appLock.lock.loadFailed")}
        footer={
          <Button variant="ghost" size="sm" isDisabled={busy} onPress={confirmSignOut}>
            <Button.Label>{t("mobile.appLock.lock.signOut")}</Button.Label>
          </Button>
        }
      >
        <Button
          variant="tertiary"
          className="rounded-full px-8"
          isDisabled={busy}
          onPress={() => void retryAppLockLoad()}
        >
          <Button.Label>{t("mobile.appLock.lock.retry")}</Button.Label>
        </Button>
      </LockLayout>
    );
  }

  const deviceKey = config.deviceUnlock ? (
    <Button
      variant="ghost"
      isIconOnly
      isDisabled={busy}
      accessibilityLabel={t("mobile.appLock.lock.useDevice", { method })}
      className="size-20 rounded-full"
      onPress={() => void promptDevice()}
    >
      <DeviceUnlockIcon kind={kind} size={30} color={foreground} />
    </Button>
  ) : null;

  const footer = confirming ? (
    <Button variant="ghost" size="sm" isDisabled={busy} onPress={cancelOwnerConfirmation}>
      <Button.Label>{t("common.cancel")}</Button.Label>
    </Button>
  ) : (
    <Button variant="ghost" size="sm" isDisabled={busy} onPress={confirmSignOut}>
      <Button.Label>{config.pin ? t("mobile.appLock.lock.forgotPin") : t("mobile.appLock.lock.signOut")}</Button.Label>
    </Button>
  );

  return (
    <LockLayout
      insets={insets}
      leaving={leaving}
      onHeaderLayout={onHeaderLayout}
      title={confirming ? t("mobile.appLock.lock.confirmTitle") : t("mobile.appLock.lock.title")}
      message={waitText ?? message ?? (config.pin ? t("mobile.appLock.lock.enterPin") : null)}
      error={waitText !== null || message !== null}
      pad={
        config.pin ? (
          <PinPad
            disabled={busy || blockedUntil !== null}
            canDelete={pin.length > 0}
            leading={deviceKey}
            onDigit={addDigit}
            onDelete={() => setPin((current) => current.slice(0, -1))}
          />
        ) : null
      }
      footer={footer}
    >
      {config.pin ? (
        <PinDots count={pin.length} />
      ) : (
        <Button
          variant="tertiary"
          className="rounded-full px-6"
          isDisabled={busy}
          accessibilityLabel={t("mobile.appLock.lock.useDevice", { method })}
          onPress={() => void promptDevice()}
        >
          <DeviceUnlockIcon kind={kind} size={20} color={buttonForeground} />
          <Button.Label>{t("mobile.appLock.lock.unlock")}</Button.Label>
        </Button>
      )}
    </LockLayout>
  );
}

/**
 * The block is the header: it takes the space that the controls leave, up to a share of the
 * screen. The title, message and main control sit in the middle of the space under it. The number
 * pad, when there is one, sits low where the thumb reaches it.
 */
function LockLayout({
  insets,
  leaving,
  onHeaderLayout,
  title,
  message,
  error = false,
  pad = null,
  footer,
  children,
}: {
  insets: EdgeInsets;
  leaving: boolean;
  onHeaderLayout: (bottom: number) => void;
  title: string;
  message: string | null;
  error?: boolean;
  pad?: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  const { height } = useWindowDimensions();
  const reduced = useReducedMotion();
  return (
    <View
      className="flex-1"
      style={{ paddingBottom: insets.bottom + 8, paddingLeft: insets.left, paddingRight: insets.right }}
    >
      <View
        style={{
          flexGrow: 1,
          flexShrink: 1,
          minHeight: insets.top + MIN_LOCK_HEADER,
          maxHeight: height * MAX_LOCK_HEADER_SHARE,
        }}
        onLayout={({ nativeEvent: { layout } }) => onHeaderLayout(layout.y + layout.height)}
      />
      <Animated.View
        entering={FadeIn.duration(300).delay(reduced ? 0 : LOCK_ENTER_DELAY_MS)}
        className="grow items-center"
        style={{ flexShrink: 0, opacity: leaving ? 0 : 1, transitionProperty: "opacity", transitionDuration: 160 }}
      >
        <View className="flex-1 items-center justify-center gap-8 self-stretch px-8 pt-6">
          <View className="items-center gap-3">
            <Typography.Heading type="h3" align="center" accessibilityRole="header">
              {title}
            </Typography.Heading>
            <View className="min-h-10">
              {message ? (
                <Typography.Paragraph
                  align="center"
                  accessibilityLiveRegion="polite"
                  className={error ? "text-danger-text" : "text-text-secondary"}
                >
                  {message}
                </Typography.Paragraph>
              ) : null}
            </View>
          </View>
          {children}
        </View>
        {pad}
        <View className="mt-4 min-h-10 justify-center">{footer}</View>
      </Animated.View>
    </View>
  );
}
