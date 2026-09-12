import { useIsFocused } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import { useCallback, useRef, useState } from "react";
import { useWindowDimensions, View } from "react-native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";

import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { redeemMobileConnectUrl } from "@/features/auth/api/mobile-auth";
import { AppLogo } from "@/features/auth/components/app-logo";
import { PixelBlastBackground } from "@/features/auth/components/pixel-blast-background";
import { ScanQrButton } from "@/features/auth/components/scan-qr-button";
import { type ScannerOrigin, ScanQrSheet } from "@/features/auth/components/scan-qr-sheet";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";

const SIGN_IN_ENTER = FadeIn.duration(220).reduceMotion(ReduceMotion.System);

export function SignInScreen() {
  const isFocused = useIsFocused();
  const { width: windowWidth } = useWindowDimensions();
  const buttonWidth = Math.min(240, windowWidth - 64);
  const { connect } = useMobileSession();
  const root = useRef<View>(null);
  const button = useRef<View>(null);
  const measuring = useRef(false);
  const [preparingScanner, setPreparingScanner] = useState(false);
  const [origin, setOrigin] = useState<ScannerOrigin | null>(null);
  const animationActive = isFocused && !preparingScanner && !origin;
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const closeScanner = useCallback(() => {
    setOrigin(null);
    setPreparingScanner(false);
    measuring.current = false;
  }, []);

  function openScanner() {
    if (measuring.current || origin || !root.current || !button.current) return;
    measuring.current = true;
    setPreparingScanner(true);
    root.current.measureInWindow((rootX, rootY) => {
      if (!button.current) {
        closeScanner();
        return;
      }
      button.current.measureInWindow((x, y, width, height) => {
        if (width <= 0 || height <= 0) {
          closeScanner();
          return;
        }
        setOrigin({ x: x - rootX, y: y - rootY, width, height });
        setPreparingScanner(false);
      });
    });
  }

  return (
    <View
      ref={root}
      className="flex-1"
      collapsable={false}
      onLayout={({ nativeEvent: { layout } }) => setViewport({ width: layout.width, height: layout.height })}
    >
      <Animated.ScrollView
        entering={SIGN_IN_ENTER}
        scrollEnabled={!origin}
        pointerEvents={origin ? "none" : "auto"}
        accessibilityElementsHidden={Boolean(origin)}
        importantForAccessibility={origin ? "no-hide-descendants" : "auto"}
        className="flex-1 bg-background"
        contentContainerClassName="min-h-full grow items-center justify-center px-8 pb-safe-offset-8 pt-safe-offset-8"
        contentInsetAdjustmentBehavior="never"
        bounces={false}
        showsVerticalScrollIndicator={false}
      >
        <PixelBlastBackground active={animationActive} />
        <View className="z-10 w-full max-w-72 items-center gap-8">
          <View className="items-center gap-5">
            <AppLogo size={56} animation={animationActive ? "blink" : "none"} interactive={animationActive} />
            <View className="items-center gap-3">
              <Typography.Heading
                type="h2"
                accessibilityRole="header"
                align="center"
                className="tracking-openbot-tight"
              >
                OpenBot
              </Typography.Heading>
              <Typography.Paragraph color="muted" align="center">
                Scan the QR code on your computer to connect.
              </Typography.Paragraph>
            </View>
          </View>
          <View ref={button} collapsable={false} style={{ width: buttonWidth, opacity: origin ? 0 : 1 }}>
            <ScanQrButton width={buttonWidth} onPress={openScanner} />
          </View>
        </View>
      </Animated.ScrollView>
      {origin && isFocused ? (
        <ScanQrSheet
          origin={origin}
          viewport={viewport}
          onClose={closeScanner}
          onScan={async (data) =>
            connect(
              await mobileAnalytics.operation("mobile_pairing_action", { action: "redeem" }, () =>
                redeemMobileConnectUrl(data),
              ),
            )
          }
        />
      ) : null}
    </View>
  );
}
