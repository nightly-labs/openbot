import { Image } from "expo-image";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useUniwind } from "uniwind";

import logo from "@/assets/icons/app-icon.png";
import backgroundDark from "@/assets/splash/background-dark.png";
import backgroundLight from "@/assets/splash/background-light.png";

// Native splash screens cannot layer a wallpaper behind a centered mark: iOS and
// Android paint one centered image on a solid color, and Android 12 and later
// enforce this at the OS level. app.json therefore uses the wallpaper base color
// with the app mark, and this backdrop takes over with the full wallpaper plus
// the same mark once JS runs. Keep BACKDROP_COLOR in sync with the plugin
// `backgroundColor` values and LOGO_SIZE with its `imageWidth`, so the handoff
// from the native splash does not jump.
const BACKDROP_COLOR = { light: "#E6C5FA", dark: "#181818" } as const;
const LOGO_SIZE = 112;
// Gap between the centered mark and the status indicator below it. The mark
// itself stays exactly centered so it keeps aligning with the native splash;
// only the indicator is offset, so it never overlaps the mark.
const LOADER_GAP = 32;
const LOADER_COLOR = { light: "#2C2C2C", dark: "#E6C5FA" } as const;

export function SplashBackdrop() {
  const { theme } = useUniwind();
  const dark = theme === "dark";

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading account"
      accessibilityState={{ busy: true }}
      style={{
        alignItems: "center",
        backgroundColor: dark ? BACKDROP_COLOR.dark : BACKDROP_COLOR.light,
        flex: 1,
        justifyContent: "center",
      }}
    >
      <Image
        accessible={false}
        contentFit="cover"
        source={dark ? backgroundDark : backgroundLight}
        style={StyleSheet.absoluteFill}
      />
      <Image accessible={false} contentFit="contain" source={logo} style={{ height: LOGO_SIZE, width: LOGO_SIZE }} />
      <View
        accessible={false}
        style={{
          alignItems: "center",
          left: 0,
          marginTop: LOGO_SIZE / 2 + LOADER_GAP,
          position: "absolute",
          right: 0,
          top: "50%",
        }}
      >
        <ActivityIndicator color={dark ? LOADER_COLOR.dark : LOADER_COLOR.light} size="small" />
      </View>
    </View>
  );
}
