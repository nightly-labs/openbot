import { useIsFocused } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import type { LucideIcon } from "lucide-react-native";
import X from "lucide-react-native/icons/x";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  AppState,
  BackHandler,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  type TextInputInstance,
  View,
} from "react-native";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, {
  FadeIn,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { type MobileSession, redeemMobileConnectUrl } from "@/features/auth/api/mobile-auth";
import type { EmailCodeInputHandle } from "@/features/auth/components/email-code-input";
import { QrScanner, type ScannerMode, type ScanStatus } from "@/features/auth/components/qr-scanner";
import {
  PANE_ENTER_DELAY_MS,
  PANE_SIDE_ENTER_DELAY_MS,
  type PaneDirection,
  paneExit,
  SIGN_IN_EASE_MOVE,
} from "@/features/auth/components/sign-in-motion";
import { CodePane, EmailPane, HELP_MOVE, OptionsPane, type PaneMotion } from "@/features/auth/components/sign-in-panes";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { type SignInStep, useEmailSignIn } from "@/features/auth/model/use-email-sign-in";
import { BLOUB_MOVE_MS } from "@/shared/components/bloub-stage/bloub-look";
import { useBloubStage, useBloubStageRequest } from "@/shared/components/bloub-stage/bloub-stage-context";
import {
  BLOUB_PRIORITY,
  type BloubMood,
  type BloubStageRequest,
} from "@/shared/components/bloub-stage/bloub-stage-store";
import { useReducedMotion } from "@/shared/lib/motion";
import { useText } from "@/shared/lib/text";
import { SPLASH_HANDOFF_DEADLINE_MS, SplashContentReadyContext } from "@/shared/lib/use-splash-gate";

// The widest sign-in column: the field, both buttons and the eight code slots share this width.
const COLUMN_MAX_WIDTH = 420;
const SIDE_MARGIN = 24;
// The block stops this far above the sign-in title.
const PANE_GAP = 40;
// The block under the status bar on the email and code steps, and the gap to their title.
const COMPACT_HEADER = 146;
const FORM_GAP = 26;
// The largest share of the screen that the header takes on the first step.
const OPTIONS_HEADER_SHARE = 0.5;
// The smallest header on the first step, when large text needs the room.
const MIN_OPTIONS_HEADER = 150;
// Space between the lowest control and the keyboard. The header never shrinks past this point.
const KEYBOARD_GAP = 24;
const MIN_LIFTED_HEADER = 64;
// The keyboard rises while the email pane comes in, as the block settles.
const EMAIL_FOCUS_MS = 380;
// The sad face after a refused value.
const SAD_MS = 1100;
// "Connected" stays on the block this long before the app takes over.
const DONE_HOLD_MS = 900;
// The camera stays under the block until the block has come back over it.
const SCANNER_RELEASE_MS = 400;

/** A link that waits for sign-in, such as an invitation. A banner above the sign-in content names it. */
export interface SignInNotice {
  icon: LucideIcon;
  title: string;
  description: string;
  cancelLabel: string;
  onCancel: () => void;
}

function SignInNoticeBanner({ notice }: { notice: SignInNotice }) {
  const [foreground, muted] = useThemeColor(["foreground", "muted"]);
  const Icon = notice.icon;
  return (
    <View className="flex-row items-start gap-3 rounded-grouped bg-grouped py-3 pr-2 pl-3">
      <View className="size-9 items-center justify-center rounded-full bg-background">
        <Icon size={18} color={foreground} strokeWidth={1.75} />
      </View>
      <View accessible accessibilityRole="summary" className="min-w-0 flex-1 gap-0.5 py-0.5">
        <Typography.Paragraph className="font-medium">{notice.title}</Typography.Paragraph>
        <Typography.Paragraph type="body-sm" className="text-grouped-secondary">
          {notice.description}
        </Typography.Paragraph>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={notice.cancelLabel}
        hitSlop={8}
        onPress={notice.onCancel}
        className="size-8 items-center justify-center rounded-full"
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      >
        <X size={18} color={muted} strokeWidth={1.75} />
      </Pressable>
    </View>
  );
}

type PaneKey = SignInStep | "none";

function enterFrom(from: PaneKey, to: PaneKey): PaneDirection {
  if (from === "email" && to === "code") return "right";
  if (from === "code" && to === "email") return "left";
  return "vertical";
}

function exitTo(from: PaneKey, to: PaneKey): PaneDirection {
  if (from === "email" && to === "code") return "left";
  if (from === "code" && to === "email") return "right";
  return "vertical";
}

interface ScanState {
  mode: ScannerMode;
  status: ScanStatus;
}

/**
 * The sign-in screen. The stage's lilac block is its header: the block covers the screen at
 * launch, rises to make room for the choices, shrinks for the email steps, covers the screen again
 * for the camera and fades so the camera shows through, while the eyes become the scanner frame.
 */
export function SignInScreen({ notice }: { notice?: SignInNotice }) {
  const { t } = useText();
  const reportContentReady = useContext(SplashContentReadyContext);
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const reduced = useReducedMotion();
  const { connect } = useMobileSession();
  const { lift, look } = useBloubStage();
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  // A new session first shows "Connected" on the block, then the app takes over under it.
  const [finished, setFinished] = useState<MobileSession | null>(null);
  const connectRef = useRef(connect);
  connectRef.current = connect;
  useEffect(() => {
    if (!finished) return;
    let attached = false;
    const attach = () => {
      if (attached) return;
      attached = true;
      connectRef.current(finished);
    };
    const hold = AppState.currentState !== "active" ? 0 : reduced ? DONE_HOLD_MS / 2 : BLOUB_MOVE_MS + DONE_HOLD_MS;
    const timer = setTimeout(attach, hold);
    // A redeemed session must never be lost, also when the screen leaves first.
    return () => {
      clearTimeout(timer);
      attach();
    };
  }, [finished, reduced]);

  const signIn = useEmailSignIn({ connect: setFinished, reduced });
  const { step } = signIn;
  const emailInput = useRef<TextInputInstance>(null);
  const codeInput = useRef<EmailCodeInputHandle>(null);

  // The scanner keeps its camera under the block until the block covers it again.
  const [scan, setScan] = useState<ScanState | null>(null);
  const [scannerMounted, setScannerMounted] = useState(false);
  useEffect(() => {
    if (scan || !scannerMounted) return;
    const timer = setTimeout(() => setScannerMounted(false), SCANNER_RELEASE_MS);
    return () => clearTimeout(timer);
  }, [scan, scannerMounted]);
  const scanBusy = scan?.status === "connecting";
  const openScanner = useCallback(() => {
    Keyboard.dismiss();
    setScan({ mode: "pending", status: "idle" });
    setScannerMounted(true);
  }, []);
  const closeScanner = useCallback(() => {
    // A redeemed code ends in the app: closing now could lose its session.
    setScan((current) => (current?.status === "connecting" ? current : null));
  }, []);
  const onModeChange = useCallback(
    (mode: ScannerMode) => setScan((current) => (current && current.mode !== mode ? { ...current, mode } : current)),
    [],
  );
  const onStatusChange = useCallback(
    (status: ScanStatus) =>
      setScan((current) => (current && current.status !== status ? { ...current, status } : current)),
    [],
  );

  // A refused value makes the eyes sad for a moment.
  const [sad, setSad] = useState(false);
  useEffect(() => {
    if (signIn.rejection === 0) return;
    setSad(true);
    const timer = setTimeout(() => setSad(false), SAD_MS);
    return () => clearTimeout(timer);
  }, [signIn.rejection]);

  // Layout of the first step. A copy that nobody sees measures the pane before the block moves, so
  // the block and the pane can move together.
  const [optionsHeight, setOptionsHeight] = useState(0);
  const [helpHeight, setHelpHeight] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  // The column stays in the middle of the space between the side insets (the iPhone Duo rail).
  const safeWidth = viewport.width - insets.left - insets.right;
  const columnWidth = Math.max(0, Math.min(COLUMN_MAX_WIDTH, safeWidth - 2 * SIDE_MARGIN));
  const columnLeft = insets.left + (safeWidth - columnWidth) / 2;
  const closedHeight = optionsHeight - helpHeight;
  const bottomPad = Math.max(insets.bottom + 8, 24);
  const minOptionsTop = insets.top + MIN_OPTIONS_HEADER + PANE_GAP;
  // The block takes at most half the screen, as in the design. Short content then sits under the
  // block, and tall content (large text) pushes the block up.
  const maxOptionsTop = Math.round(viewport.height * OPTIONS_HEADER_SHARE) + PANE_GAP;
  const optionsTop = Math.max(minOptionsTop, Math.min(maxOptionsTop, viewport.height - bottomPad - closedHeight));
  const measured = viewport.height > 0 && optionsHeight > 0;
  const optionsBottom = optionsTop - PANE_GAP - (helpOpen ? helpHeight : 0);
  const compactBottom = insets.top + COMPACT_HEADER;
  const formTop = compactBottom + FORM_GAP;
  const helpShift = useSharedValue(0);
  const staticShift = useSharedValue(0);
  useEffect(() => {
    const shift = helpOpen ? helpHeight : 0;
    helpShift.set(reduced ? shift : withTiming(shift, HELP_MOVE));
  }, [helpHeight, helpOpen, helpShift, reduced]);
  useEffect(() => {
    if (step !== "options") setHelpOpen(false);
  }, [step]);

  // Uncover the app once the first step can be placed. A lost layout must not keep the splash.
  useEffect(() => {
    if (measured) {
      reportContentReady();
      return;
    }
    const deadline = setTimeout(reportContentReady, SPLASH_HANDOFF_DEADLINE_MS);
    return () => clearTimeout(deadline);
  }, [measured, reportContentReady]);

  const close = {
    icon: "close" as const,
    label: t("mobile.auth.closeScanner"),
    onPress: closeScanner,
    disabled: scanBusy,
  };
  const formMood: BloubMood = signIn.verified
    ? "happy"
    : signIn.sending || signIn.verifying
      ? "think"
      : sad
        ? "sad"
        : "down";
  const request: BloubStageRequest | null = !isFocused
    ? null
    : finished
      ? {
          shape: { kind: "cover" },
          mood: "happy",
          caption: { title: t("mobile.auth.done.title"), text: t("mobile.auth.done.body") },
          // "Connected" covers the screen like the loader that follows it, so it dims in dark mode.
          loader: true,
        }
      : scan
        ? scan.mode === "camera"
          ? { shape: { kind: "clear" }, mood: scanBusy ? "found" : "frame", back: close }
          : scan.mode === "permission"
            ? { shape: { kind: "header", bottom: compactBottom }, mood: "down", back: close }
            : { shape: { kind: "cover" }, mood: "think", back: close }
        : scannerMounted
          ? // The block covers the camera again before it moves to the header, so the camera never
            // shows below a rising edge.
            { shape: { kind: "cover" }, mood: "idle" }
          : step === "options"
            ? { shape: measured ? { kind: "header", bottom: optionsBottom } : { kind: "cover" }, mood: "idle" }
            : {
                shape: { kind: "header", bottom: compactBottom },
                mood: formMood,
                back: {
                  icon: "back",
                  label: t("common.back"),
                  onPress: signIn.back,
                  disabled: signIn.sending || signIn.verifying || signIn.verified,
                },
              };
  const active = useBloubStageRequest(request, BLOUB_PRIORITY.screen);
  // The content comes in when the stage first shows this screen, not under the splash.
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (active) setRevealed(true);
  }, [active]);

  // The eyes follow the text cursor while the user types.
  const emailLength = signIn.email.length;
  const codeLength = signIn.code.length;
  const looking = !finished && !scan;
  useEffect(() => {
    if (!looking || step === "options") look(0, 0);
    else if (step === "email") look(-16 + Math.min(emailLength, 26) * 1.25, 9);
    else look(-22 + Math.min(codeLength, 7) * 6.4, 9);
  }, [codeLength, emailLength, look, looking, step]);

  // The pane on the screen follows the target one render later, so the leaving pane knows where
  // the next one comes from and leaves the other way.
  const target: PaneKey = !revealed || finished || scan || scannerMounted ? "none" : step;
  const [pane, setPane] = useState<{ key: PaneKey; from: PaneDirection }>({ key: "none", from: "vertical" });
  useEffect(() => {
    if (pane.key !== target) setPane({ key: target, from: enterFrom(pane.key, target) });
  }, [pane.key, target]);
  const exit = paneExit(exitTo(pane.key, target), reduced);
  const motion: PaneMotion = {
    from: pane.from,
    startMs: pane.from === "vertical" ? PANE_ENTER_DELAY_MS : PANE_SIDE_ENTER_DELAY_MS,
    reduced,
  };

  // The keyboard opens while the email pane comes in. From the code step it is already open.
  useEffect(() => {
    if (pane.key !== "email") return;
    const timer = setTimeout(
      () => emailInput.current?.focus(),
      pane.from === "vertical" && !reduced ? EMAIL_FOCUS_MS : 0,
    );
    return () => clearTimeout(timer);
  }, [pane.from, pane.key, reduced]);
  // A new code unlocks the slots again. Put the cursor back in them.
  useEffect(() => {
    if (pane.key === "code" && signIn.challenge && !signIn.needsNewCode) codeInput.current?.focus();
  }, [pane.key, signIn.challenge, signIn.needsNewCode]);

  // The keyboard covers the lower half. The email steps lift their pane and shrink the header just
  // enough to keep the lowest control above it, frame by frame on the UI thread.
  const [formHeight, setFormHeight] = useState(0);
  const formStep = pane.key === "email" || pane.key === "code";
  const formBottom = useSharedValue(0);
  useEffect(() => {
    const bottom = formStep && formHeight > 0 ? formTop + formHeight : 0;
    formBottom.set(
      reduced || formBottom.get() === 0 ? bottom : withTiming(bottom, { duration: 300, easing: SIGN_IN_EASE_MOVE }),
    );
  }, [formBottom, formHeight, formStep, formTop, reduced]);
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
  const viewportHeight = viewport.height;
  const maxLift = Math.max(0, compactBottom - insets.top - MIN_LIFTED_HEADER);
  useAnimatedReaction(
    () => {
      const bottom = formBottom.get();
      if (bottom <= 0) return 0;
      const overlap = bottom + KEYBOARD_GAP - (viewportHeight - Math.abs(keyboardHeight.get()));
      return Math.min(maxLift, Math.max(0, overlap));
    },
    (value) => lift.set(value),
  );
  useEffect(() => () => lift.set(0), [lift]);
  const liftStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -lift.get() }] }));

  // The Android back button closes the scanner, then returns one step before it leaves the screen.
  const back = useRef(signIn.back);
  back.current = signIn.back;
  const scanning = scan !== null;
  useEffect(() => {
    if (!scanning && step === "options") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (scanning) closeScanner();
      else back.current();
      return true;
    });
    return () => subscription.remove();
  }, [closeScanner, scanning, step]);

  const overflow = optionsTop + closedHeight + bottomPad > viewport.height;
  const contentHeight = Math.max(viewport.height, pane.key === "options" ? optionsTop + closedHeight + bottomPad : 0);
  const noticeBanner = notice ? <SignInNoticeBanner notice={notice} /> : null;
  const column = { position: "absolute" as const, left: columnLeft, width: columnWidth };

  return (
    <View
      className="flex-1 bg-background"
      onLayout={({ nativeEvent: { layout } }) => setViewport({ width: layout.width, height: layout.height })}
    >
      {columnWidth > 0 ? (
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[column, { top: 0, opacity: 0 }]}
        >
          <OptionsPane
            motion={null}
            notice={noticeBanner}
            helpOpen={false}
            helpShift={staticShift}
            onToggleHelp={() => undefined}
            onScan={() => undefined}
            onEmail={() => undefined}
            onLayout={setOptionsHeight}
            onHelpLayout={setHelpHeight}
            reduced={reduced}
          />
        </View>
      ) : null}
      <ScrollView
        style={StyleSheet.absoluteFill}
        contentContainerStyle={{ height: contentHeight }}
        scrollEnabled={pane.key === "options" && overflow}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="never"
        bounces={false}
        showsVerticalScrollIndicator={false}
      >
        {pane.key === "options" ? (
          <Animated.View key="options" exiting={exit} style={[column, { top: optionsTop }]}>
            <OptionsPane
              motion={motion}
              notice={noticeBanner}
              helpOpen={helpOpen}
              helpShift={helpShift}
              onToggleHelp={() => setHelpOpen((open) => !open)}
              onScan={openScanner}
              onEmail={signIn.openEmail}
              reduced={reduced}
            />
          </Animated.View>
        ) : null}
        {pane.key === "email" ? (
          <Animated.View key="email" exiting={exit} style={[column, { top: formTop }]}>
            <Animated.View style={liftStyle}>
              <EmailPane
                signIn={signIn}
                motion={motion}
                emailInput={emailInput}
                onScanInstead={openScanner}
                onLayout={setFormHeight}
                reduced={reduced}
              />
            </Animated.View>
          </Animated.View>
        ) : null}
        {pane.key === "code" ? (
          <Animated.View key="code" exiting={exit} style={[column, { top: formTop }]}>
            <Animated.View style={liftStyle}>
              <CodePane
                signIn={signIn}
                motion={motion}
                codeInput={codeInput}
                onLayout={setFormHeight}
                reduced={reduced}
              />
            </Animated.View>
          </Animated.View>
        ) : null}
      </ScrollView>
      {scannerMounted ? (
        <View style={StyleSheet.absoluteFill} pointerEvents={scan ? "box-none" : "none"}>
          <QrScanner
            immersive
            contentInsetTop={compactBottom + 16}
            scanEnabled={scan?.mode === "camera" && !finished}
            onModeChange={onModeChange}
            onStatusChange={onStatusChange}
            renderOverlay={(camera) =>
              camera && scan?.mode === "camera" && !finished ? (
                <Animated.View
                  entering={FadeIn.duration(200).delay(reduced ? 0 : 650)}
                  pointerEvents="none"
                  className="absolute items-center"
                  style={{ top: insets.top + 15, left: insets.left + 64, right: insets.right + 64 }}
                >
                  <Typography.Paragraph align="center" className="font-semibold text-white">
                    {t("mobile.auth.scanner.scanDesktop")}
                  </Typography.Paragraph>
                </Animated.View>
              ) : null
            }
            onScan={async (data) => {
              const session = await mobileAnalytics.operation(
                "mobile_pairing_action",
                { action: "redeem", entry_point: "qr" },
                () => redeemMobileConnectUrl(data),
              );
              setFinished(session);
            }}
          />
        </View>
      ) : null}
    </View>
  );
}
