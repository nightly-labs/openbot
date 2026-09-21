import { useIsFocused } from "expo-router/react-navigation";
import { Accordion, Typography } from "heroui-native";
import { useCallback, useContext, useLayoutEffect, useRef, useState } from "react";
import { ScrollView, useWindowDimensions, View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { redeemMobileConnectUrl } from "@/features/auth/api/mobile-auth";
import { AppLogo } from "@/features/auth/components/app-logo";
import { ScanQrButton } from "@/features/auth/components/scan-qr-button";
import { type ScannerOrigin, ScanQrSheet } from "@/features/auth/components/scan-qr-sheet";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { SplashWallpaper } from "@/shared/components/splash-backdrop";
import { SPLASH_LOGO_SIZE, SPLASH_MORPH_START, splashReveal, splashTravel } from "@/shared/lib/splash-motion";
import {
  SPLASH_HANDOFF_DEADLINE_MS,
  SplashContentReadyContext,
  SplashMotionContext,
} from "@/shared/lib/use-splash-gate";

const HERO_SIZE = 72;
const HELP_GAP = 12;

function useContentReveal(delay: number) {
  const motion = useContext(SplashMotionContext);
  const progress = motion?.progress;
  const reducedMotion = motion?.reducedMotion ?? false;
  return useAnimatedStyle(() => {
    const opacity = progress ? splashReveal(progress.get(), delay, reducedMotion) : 1;
    return { opacity, transform: [{ translateY: reducedMotion ? 0 : (1 - opacity) * 8 }] };
  });
}

export function SignInScreen() {
  const reportContentReady = useContext(SplashContentReadyContext);
  const motion = useContext(SplashMotionContext);
  const insets = useSafeAreaInsets();
  const titleStyle = useContentReveal(280);
  const actionsStyle = useContentReveal(340);
  const hero = useRef<View>(null);
  const [heroOffset, setHeroOffset] = useState({ x: 0, y: 0 });
  const progress = motion?.progress;
  const reduced = motion?.reducedMotion ?? false;
  const heroStyle = useAnimatedStyle(() => {
    const p = progress ? splashTravel(progress.get(), reduced) : 1;
    return {
      opacity: reduced ? p : Math.max(0, (p - SPLASH_MORPH_START) / (1 - SPLASH_MORPH_START)),
      transform: [
        { translateX: reduced ? 0 : heroOffset.x * (1 - p) },
        { translateY: reduced ? 0 : heroOffset.y * (1 - p) },
        { scale: reduced ? 1 : 1 + (SPLASH_LOGO_SIZE / HERO_SIZE - 1) * (1 - p) },
      ],
    };
  });
  const isFocused = useIsFocused();
  const { width: windowWidth } = useWindowDimensions();
  const buttonWidth = Math.min(240, windowWidth - 64);
  const { connect } = useMobileSession();
  const measurementDeadline = useRef<ReturnType<typeof setTimeout> | null>(null);
  const root = useRef<View>(null);
  const button = useRef<View>(null);
  const [origin, setOrigin] = useState<ScannerOrigin | null>(null);
  const scannerOpen = origin !== null;
  const animationActive = isFocused && !scannerOpen && (motion?.complete ?? true);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [mainHeight, setMainHeight] = useState(0);
  const [helpTriggerHeight, setHelpTriggerHeight] = useState(0);
  // Centre the closed composition. Expanded help adds scrollable content below it.
  const closedHeight = mainHeight + HELP_GAP + helpTriggerHeight;
  const contentTop = insets.top + Math.max(32, (viewport.height - insets.top - insets.bottom - closedHeight) / 2);
  const closeScanner = useCallback(() => {
    setOrigin(null);
  }, []);

  const reportHero = useCallback(() => {
    if (viewport.height <= 0 || viewport.width <= 0 || mainHeight <= 0 || helpTriggerHeight <= 0) return;
    root.current?.measureInWindow((rootX, rootY, width, height) => {
      hero.current?.measureInWindow((x, y, heroWidth) => {
        if (heroWidth <= 0) return;
        setHeroOffset({ x: rootX + width / 2 - x - heroWidth / 2, y: rootY + height / 2 - y - heroWidth / 2 });
        reportContentReady({ x, y, size: heroWidth });
      });
    });
  }, [reportContentReady, viewport.height, viewport.width, mainHeight, helpTriggerHeight]);

  useLayoutEffect(() => {
    if (viewport.height <= 0 || motion?.revealing) return;
    // Measurement normally completes with layout. A missing native callback must
    // degrade to a fade, never strand the user behind the splash.
    measurementDeadline.current = setTimeout(() => reportContentReady(), SPLASH_HANDOFF_DEADLINE_MS);
    reportHero();
    return () => {
      if (measurementDeadline.current) clearTimeout(measurementDeadline.current);
    };
  }, [motion?.revealing, reportContentReady, reportHero, viewport.height]);

  function openScanner() {
    motion?.finish();
    root.current?.measureInWindow((rootX, rootY) => {
      button.current?.measureInWindow((x, y, width, height) => {
        if (width <= 0 || height <= 0) return;
        setOrigin({ x: x - rootX, y: y - rootY, width, height });
      });
    });
  }

  return (
    <View
      ref={root}
      className="flex-1 bg-background"
      collapsable={false}
      onLayout={({ nativeEvent: { layout } }) => setViewport({ width: layout.width, height: layout.height })}
    >
      <SplashWallpaper />
      <ScrollView
        onScrollBeginDrag={motion?.finish}
        scrollEnabled={!scannerOpen}
        pointerEvents={scannerOpen ? "none" : "auto"}
        accessibilityElementsHidden={scannerOpen}
        importantForAccessibility={scannerOpen ? "no-hide-descendants" : "auto"}
        className="flex-1"
        contentContainerClassName="items-center px-8"
        contentContainerStyle={{
          paddingTop: contentTop,
          paddingBottom: insets.bottom + 32,
        }}
        contentInsetAdjustmentBehavior="never"
        bounces={false}
        showsVerticalScrollIndicator={false}
      >
        <View className="w-full max-w-80 items-center" style={{ gap: HELP_GAP }} onLayout={reportHero}>
          <View
            className="w-full items-center gap-8"
            onLayout={({ nativeEvent: { layout } }) => setMainHeight(layout.height)}
          >
            <View ref={hero} collapsable={false} onLayout={reportHero} style={{ width: HERO_SIZE, height: HERO_SIZE }}>
              <Animated.View style={heroStyle}>
                <AppLogo
                  size={HERO_SIZE}
                  animation={animationActive ? "blink" : "none"}
                  interactive={animationActive}
                />
              </Animated.View>
            </View>
            <Animated.View style={titleStyle} className="items-center gap-3">
              <Typography.Heading
                type="h2"
                accessibilityRole="header"
                align="center"
                className="tracking-openbot-tight"
              >
                Your agents, anywhere.
              </Typography.Heading>
              <Typography.Paragraph color="muted" align="center">
                Connect to OpenBot on your computer.
              </Typography.Paragraph>
            </Animated.View>
            <Animated.View style={actionsStyle}>
              <View ref={button} collapsable={false} style={{ width: buttonWidth, opacity: scannerOpen ? 0 : 1 }}>
                <ScanQrButton width={buttonWidth} onPress={openScanner} />
              </View>
            </Animated.View>
          </View>
          <Animated.View style={actionsStyle} className="w-full">
            <Accordion className="w-full" hideSeparator animation={motion?.reducedMotion ? "disable-all" : undefined}>
              <Accordion.Item value="desktop-qr">
                <View onLayout={({ nativeEvent: { layout } }) => setHelpTriggerHeight(layout.height)}>
                  <Accordion.Trigger className="min-h-11 justify-center gap-2">
                    <Typography color="muted" className="text-caption">
                      Where is the QR code?
                    </Typography>
                    <Accordion.Indicator />
                  </Accordion.Trigger>
                </View>
                <Accordion.Content>
                  <View className="gap-3 pt-3">
                    <Typography.Paragraph color="muted">1. Open OpenBot on your computer.</Typography.Paragraph>
                    <Typography.Paragraph color="muted">2. Go to Settings → Mobile Connect.</Typography.Paragraph>
                    <Typography.Paragraph color="muted">
                      3. Choose Generate QR code, then scan it here.
                    </Typography.Paragraph>
                  </View>
                </Accordion.Content>
              </Accordion.Item>
            </Accordion>
          </Animated.View>
        </View>
      </ScrollView>
      {origin && isFocused ? (
        <ScanQrSheet
          origin={origin}
          viewport={viewport}
          onClose={closeScanner}
          onScan={async (data, beforeConnect) => {
            const session = await mobileAnalytics.operation("mobile_pairing_action", { action: "redeem" }, () =>
              redeemMobileConnectUrl(data),
            );
            try {
              await beforeConnect();
            } finally {
              connect(session);
            }
          }}
        />
      ) : null}
    </View>
  );
}
