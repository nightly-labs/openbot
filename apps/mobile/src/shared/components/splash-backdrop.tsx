import { Image } from "expo-image";
import { useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import Animated, { type SharedValue, useAnimatedStyle } from "react-native-reanimated";
import { useUniwind } from "uniwind";

import logo from "@/assets/icons/app-icon.png";
import backgroundDark from "@/assets/splash/background-dark.webp";
import backgroundLight from "@/assets/splash/background-light.webp";
import { SPLASH_LOGO_SIZE, SPLASH_MORPH_START, splashTravel } from "@/shared/lib/splash-motion";
import { useText } from "@/shared/lib/text";
import type { SplashArtwork, SplashLogoTarget } from "@/shared/lib/use-splash-gate";

// Native splash screens cannot layer a wallpaper behind a centered mark: iOS and
// Android paint one centered image on a solid color, and Android 12 and later
// enforce this at the OS level. app.json therefore uses the wallpaper base color
// with the app mark, and this backdrop takes over with the full wallpaper plus
// the same mark once JS runs. Keep BACKDROP_COLOR in sync with the plugin
// `backgroundColor` values and SPLASH_LOGO_SIZE with its `imageWidth`, so the handoff
// from the native splash does not jump.
const BACKDROP_COLOR = { light: "#E6C5FA", dark: "#181818" } as const;

// Gap between the centered mark and the status indicator below it. The mark
// itself stays exactly centered so it keeps aligning with the native splash;
// only the indicator is offset, so it never overlaps the mark.
const LOADER_GAP = 32;
const LOADER_COLOR = { light: "#2C2C2C", dark: "#E6C5FA" } as const;

interface SplashBackdropProps {
  // Reports each image the moment it is rendered on screen, not merely loaded.
  // useSplashGate holds the native splash until every source has reported, so
  // the handoff never exposes a backdrop that is still only its base color.
  onArtworkDisplay?: (artwork: SplashArtwork) => void;
  progress: SharedValue<number>;
  target: SplashLogoTarget | null;
  reducedMotion: boolean;
}

// Keep the splash motif behind the guidance without competing with readable text.
export function SplashWallpaper() {
  const { theme } = useUniwind();
  return (
    <Image
      accessible={false}
      contentFit="cover"
      source={theme === "dark" ? backgroundDark : backgroundLight}
      style={[StyleSheet.absoluteFill, { opacity: 0.08 }]}
    />
  );
}

export function SplashBackdrop({ onArtworkDisplay, progress, target, reducedMotion }: SplashBackdropProps) {
  const { theme } = useUniwind();
  const { t } = useText();
  const dark = theme === "dark";
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: 1 - (target ? splashTravel(progress.get(), reducedMotion) : progress.get()),
  }));
  const loaderStyle = useAnimatedStyle(() => ({ opacity: Math.max(0, 1 - progress.get() * 4) }));
  const logoStyle = useAnimatedStyle(() => {
    const p = target ? splashTravel(progress.get(), reducedMotion) : progress.get();
    const morph = reducedMotion || !target ? p : Math.max(0, (p - SPLASH_MORPH_START) / (1 - SPLASH_MORPH_START));
    return {
      opacity: 1 - morph,
      transform: [
        { translateX: reducedMotion || !target ? 0 : (target.x + target.size / 2 - viewport.width / 2) * p },
        { translateY: reducedMotion || !target ? 0 : (target.y + target.size / 2 - viewport.height / 2) * p },
        { scale: reducedMotion || !target ? 1 : 1 + (target.size / SPLASH_LOGO_SIZE - 1) * p },
      ],
    };
  });

  return (
    <View
      onLayout={({ nativeEvent: { layout } }) => setViewport({ width: layout.width, height: layout.height })}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t("mobile.shared.splash.loading")}
      accessibilityState={{ busy: true }}
      style={{
        alignItems: "center",
        flex: 1,
        justifyContent: "center",
      }}
    >
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: dark ? BACKDROP_COLOR.dark : BACKDROP_COLOR.light },
          backdropStyle,
        ]}
      >
        <Image
          accessible={false}
          contentFit="cover"
          onDisplay={() => onArtworkDisplay?.("wallpaper")}
          source={dark ? backgroundDark : backgroundLight}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      <Animated.View style={logoStyle}>
        <Image
          accessible={false}
          contentFit="contain"
          onDisplay={() => onArtworkDisplay?.("mark")}
          source={logo}
          style={{ height: SPLASH_LOGO_SIZE, width: SPLASH_LOGO_SIZE }}
        />
      </Animated.View>
      <Animated.View
        accessible={false}
        style={[
          {
            alignItems: "center",
            left: 0,
            marginTop: SPLASH_LOGO_SIZE / 2 + LOADER_GAP,
            position: "absolute",
            right: 0,
            top: "50%",
          },
          loaderStyle,
        ]}
      >
        <ActivityIndicator color={dark ? LOADER_COLOR.dark : LOADER_COLOR.light} size="small" />
      </Animated.View>
    </View>
  );
}
