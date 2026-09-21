import { BlurTargetView, BlurView } from "expo-blur";
import { Typography } from "heroui-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, BackHandler, Pressable, StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  interpolateColor,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { useCSSVariable } from "uniwind";

import { QrScanner } from "@/features/auth/components/qr-scanner";
import { ScanQrButton } from "./scan-qr-button";
import { ScannerCloseButton } from "./scanner-close-button";

export interface ScannerOrigin {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Shared brand curve for a continuous shape change in both directions.
const EASE_MORPH = Easing.bezier(0.77, 0, 0.175, 1);

export function ScanQrSheet({
  origin,
  viewport,
  onClose,
  onScan,
}: {
  origin: ScannerOrigin;
  viewport: { width: number; height: number };
  onClose: () => void;
  onScan: (data: string, beforeConnect: () => Promise<void>) => Promise<void>;
}) {
  const [phase, setPhase] = useState<"opening" | "open" | "closing" | "closed">("opening");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const closing = useRef(false);
  const startedOpening = useRef(false);
  const progress = useSharedValue(0);
  const departure = useSharedValue(0);
  const finishDeparture = useRef<(() => void) | null>(null);
  const blurTarget = useRef<View>(null);
  const reducedMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const brand = String(useCSSVariable("--openbot-logo-production") ?? "#cdadec");
  const surface = String(useCSSVariable("--openbot-bg-sheet"));
  const scrim = String(useCSSVariable("--openbot-drawer-scrim"));
  const radius = Number.parseFloat(String(useCSSVariable("--openbot-radius-lg") ?? "12"));
  const width = Math.min(400, viewport.width - 32);
  const height = Math.min(560, viewport.height - insets.top - insets.bottom - 32);
  const x = (viewport.width - width) / 2;
  const y = viewport.height - insets.bottom - 16 - height;

  const finishOpen = useCallback(() => {
    if (!closing.current) setPhase("open");
  }, []);
  const finishClose = useCallback(() => {
    setPhase("closed");
    onClose();
  }, [onClose]);
  const beginOpening = useCallback(() => {
    if (closing.current || startedOpening.current) return;
    startedOpening.current = true;
    progress.set(
      withTiming(
        1,
        { duration: reducedMotion ? 160 : 400, easing: EASE_MORPH, reduceMotion: ReduceMotion.Never },
        (finished) => {
          if (finished) scheduleOnRN(finishOpen);
        },
      ),
    );
  }, [finishOpen, progress, reducedMotion]);
  const releaseDeparture = useCallback(() => {
    finishDeparture.current?.();
    finishDeparture.current = null;
  }, []);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") releaseDeparture();
    });
    return () => {
      subscription.remove();
      cancelAnimation(progress);
      cancelAnimation(departure);
      releaseDeparture();
    };
  }, [departure, progress, releaseDeparture]);

  function beforeConnect(): Promise<void> {
    if (AppState.currentState !== "active") return Promise.resolve();
    return new Promise((resolve) => {
      // A lost native callback must never prevent attachment of a redeemed session.
      const deadline = setTimeout(releaseDeparture, 1000);
      finishDeparture.current = () => {
        clearTimeout(deadline);
        resolve();
      };
      departure.set(
        withTiming(
          1,
          {
            duration: reducedMotion ? 160 : 280,
            easing: Easing.bezier(0.23, 1, 0.32, 1),
            reduceMotion: ReduceMotion.Never,
          },
          (finished) => {
            if (finished) scheduleOnRN(releaseDeparture);
          },
        ),
      );
    });
  }

  const close = useCallback(() => {
    if (busyRef.current || closing.current) return;
    closing.current = true;
    // Block scans immediately, but retain the preview until the fade finishes.
    setPhase("closing");
    progress.set(
      withTiming(
        0,
        { duration: reducedMotion ? 160 : 400, easing: EASE_MORPH, reduceMotion: ReduceMotion.Never },
        (finished) => {
          if (finished) scheduleOnRN(finishClose);
        },
      ),
    );
  }, [finishClose, progress, reducedMotion]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      close();
      return true;
    });
    return () => subscription.remove();
  }, [close]);

  async function scan(data: string) {
    if (busyRef.current || closing.current) return;
    // Redemption consumes and stores a one-time session. Keep this surface open
    // until it settles, so a close cannot leave a saved but unattached session.
    busyRef.current = true;
    setBusy(true);
    try {
      await onScan(data, beforeConnect);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  // Animate only this absolute clip. Its children keep their final dimensions;
  // the native camera never changes size or stretches with the button surface.
  const departureStyle = useAnimatedStyle(() => ({
    opacity: (reducedMotion ? progress.get() : 1) * (1 - departure.get()),
    transform: [{ translateY: reducedMotion ? 0 : -24 * departure.get() }],
  }));
  const coverStyle = useAnimatedStyle(() => ({ opacity: departure.get() }));
  const panelStyle = useAnimatedStyle(() => {
    const p = reducedMotion ? 1 : progress.get();
    return {
      left: origin.x + (x - origin.x) * p,
      top: origin.y + (y - origin.y) * p,
      width: origin.width + (width - origin.width) * p,
      height: origin.height + (height - origin.height) * p,
      borderRadius: radius * (1 + p),
      backgroundColor: interpolateColor(p, [0, 1], [brand, surface]),
      opacity: reducedMotion ? progress.get() : 1,
    };
  });
  const previewStyle = useAnimatedStyle(() => {
    const p = progress.get();
    return {
      opacity: reducedMotion ? p : Math.min(1, Math.max(0, (p - 0.2) / 0.65)),
      transform: [
        { translateX: reducedMotion ? 0 : ((origin.width - width) * (1 - p)) / 2 },
        { translateY: reducedMotion ? 0 : ((origin.height - height) * (1 - p)) / 2 },
      ],
    };
  });
  const buttonStyle = useAnimatedStyle(() => ({
    opacity: reducedMotion ? 0 : Math.max(0, 1 - progress.get() / 0.3),
    transform: [
      { translateX: ((width - origin.width) * progress.get()) / 2 },
      { translateY: ((height - origin.height) * progress.get()) / 2 },
    ],
  }));
  const blurStyle = useAnimatedStyle(() => ({ opacity: 1 - progress.get() }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.get() * 0.6 }));

  return (
    <View style={StyleSheet.absoluteFill} accessibilityViewIsModal onAccessibilityEscape={close}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: scrim }, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} accessible={false} onPress={close} />
      </Animated.View>
      <Animated.View pointerEvents="none" className="bg-background" style={[StyleSheet.absoluteFill, coverStyle]} />
      <Animated.View className="absolute overflow-hidden" style={[panelStyle, departureStyle]}>
        {phase !== "closed" ? (
          <Animated.View
            pointerEvents={phase === "open" ? "auto" : "none"}
            accessibilityElementsHidden={phase !== "open"}
            importantForAccessibility={phase === "open" ? "auto" : "no-hide-descendants"}
            className="absolute"
            style={[{ width, height }, previewStyle]}
          >
            <BlurTargetView ref={blurTarget} style={{ flex: 1 }}>
              <QrScanner
                embedded
                onPreviewReady={beginOpening}
                scanEnabled={phase === "open"}
                onScan={scan}
                renderOverlay={(camera) => (
                  <View
                    pointerEvents="box-none"
                    className="absolute inset-x-0 top-0 flex-row items-center justify-between gap-3 px-5 py-3"
                  >
                    <Typography.Heading type="h4" className={camera ? "text-white" : undefined}>
                      Scan QR code
                    </Typography.Heading>
                    <ScannerCloseButton disabled={busy} onPress={close} />
                  </View>
                )}
              />
            </BlurTargetView>
            {!reducedMotion && phase !== "open" ? (
              <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, blurStyle]}>
                <BlurView
                  blurTarget={blurTarget}
                  blurMethod="dimezisBlurViewSdk31Plus"
                  intensity={16}
                  tint="systemUltraThinMaterial"
                  style={StyleSheet.absoluteFill}
                />
              </Animated.View>
            ) : null}
          </Animated.View>
        ) : null}
        {phase !== "open" && !reducedMotion ? (
          <Animated.View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            className="absolute"
            style={[{ width: origin.width, height: origin.height }, buttonStyle]}
          >
            <ScanQrButton width={origin.width} onPress={close} />
          </Animated.View>
        ) : null}
      </Animated.View>
    </View>
  );
}
