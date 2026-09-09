import { Typography } from "heroui-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, Pressable, StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  interpolate,
  interpolateColor,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { useCSSVariable } from "uniwind";

import { QrScanner } from "@/features/auth/components/qr-scanner";
import { ScanQrButton } from "@/features/auth/components/scan-qr-button";
import { ScannerCloseButton } from "./scanner-close-button";

export interface ScannerOrigin {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MORPH = { duration: 400, dampingRatio: 1, reduceMotion: ReduceMotion.System };

// A route sheet cannot morph from the measured button bounds. This in-content
// surface uses the existing native camera and HeroUI controls, without navigation.
export function ScanQrSheet({
  origin,
  viewport,
  onClose,
  onScan,
}: {
  origin: ScannerOrigin;
  viewport: { width: number; height: number };
  onClose: () => void;
  onScan: (data: string) => Promise<void>;
}) {
  const [phase, setPhase] = useState<"opening" | "open" | "closing">("opening");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const closing = useRef(false);
  const progress = useSharedValue(0);
  const insets = useSafeAreaInsets();
  const brand = String(useCSSVariable("--openbot-logo-production") ?? "#cdadec");
  const surface = String(useCSSVariable("--openbot-bg-sheet"));
  const scrim = String(useCSSVariable("--openbot-drawer-scrim"));
  const radius = Number.parseFloat(String(useCSSVariable("--openbot-radius-lg") ?? "12"));
  const width = Math.min(400, viewport.width - 32);
  const height = Math.min(560, viewport.height - insets.top - insets.bottom - 32);
  const x = (viewport.width - width) / 2;
  const y = viewport.height - insets.bottom - 16 - height;

  const finishOpen = useCallback(() => setPhase("open"), []);
  useEffect(() => {
    progress.set(
      withSpring(1, MORPH, (finished) => {
        if (finished) scheduleOnRN(finishOpen);
      }),
    );
    return () => cancelAnimation(progress);
  }, [finishOpen, progress]);

  const close = useCallback(() => {
    if (busyRef.current || closing.current) return;
    closing.current = true;
    // Remove the camera before collapsing its native surface.
    setPhase("closing");
    progress.set(
      withSpring(0, MORPH, (finished) => {
        if (finished) scheduleOnRN(onClose);
      }),
    );
  }, [onClose, progress]);

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
      await onScan(data);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const panelStyle = useAnimatedStyle(() => {
    const p = progress.get();
    return {
      left: interpolate(p, [0, 1], [origin.x, x]),
      top: interpolate(p, [0, 1], [origin.y, y]),
      width: interpolate(p, [0, 1], [origin.width, width]),
      height: interpolate(p, [0, 1], [origin.height, height]),
      borderRadius: interpolate(p, [0, 1], [radius, radius * 2]),
    };
  });
  // Keep the fixed-size preview centered inside the changing clip bounds.
  // Anchoring it at top-left makes the content slide diagonally during the morph.
  const scannerStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, (progress.get() - 0.55) / 0.45)),
    transform: [
      { translateX: ((origin.width - width) * (1 - progress.get())) / 2 },
      { translateY: ((origin.height - height) * (1 - progress.get())) / 2 },
    ],
  }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.get() * 0.45 }));
  const sourceButtonStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0, 1 - progress.get() * 5),
    transform: [
      { translateX: ((width - origin.width) * progress.get()) / 2 },
      { translateY: ((height - origin.height) * progress.get()) / 2 },
    ],
  }));
  // Native button padding, type and material need to match at handoff. Fade the
  // morph surface out before returning to the same button component below it.
  const surfaceStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.get(), [0, 1], [brand, surface]),
    opacity: Math.min(1, Math.max(0, progress.get() * 5)),
  }));

  return (
    <View style={StyleSheet.absoluteFill} accessibilityViewIsModal onAccessibilityEscape={close}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: scrim }, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} accessible={false} onPress={close} />
      </Animated.View>
      <Animated.View className="absolute overflow-hidden" style={panelStyle}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, surfaceStyle]} />
        {phase !== "closing" ? (
          <Animated.View
            pointerEvents={phase === "open" ? "auto" : "none"}
            accessibilityElementsHidden={phase !== "open"}
            importantForAccessibility={phase === "open" ? "auto" : "no-hide-descendants"}
            className="absolute"
            style={[{ width, height }, scannerStyle]}
          >
            <QrScanner
              embedded
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
          </Animated.View>
        ) : null}
        {phase !== "open" ? (
          <Animated.View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            className="absolute"
            style={[{ width: origin.width, height: origin.height }, sourceButtonStyle]}
          >
            <ScanQrButton width={origin.width} onPress={close} />
          </Animated.View>
        ) : null}
      </Animated.View>
    </View>
  );
}
