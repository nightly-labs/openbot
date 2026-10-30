import type { DefaultTheme } from "expo-router/react-navigation";
import { isIOS } from "@/shared/lib/platform";

/**
 * The app font, as on desktop and web. The expo-font plugin in app.json embeds it as one family, so
 * `fontWeight` picks the face. A build without the files falls back to the system font.
 */
export const APP_FONT = "Inter";

/**
 * React Navigation fonts with the weights of its default theme. Native header titles, back titles and
 * toolbar labels read them.
 */
export const navigationFonts = {
  regular: { fontFamily: APP_FONT, fontWeight: "400" },
  medium: { fontFamily: APP_FONT, fontWeight: "500" },
  bold: { fontFamily: APP_FONT, fontWeight: "600" },
  heavy: { fontFamily: APP_FONT, fontWeight: "700" },
} as const satisfies typeof DefaultTheme.fonts;

/**
 * The header title font on iOS. Expo Router 58 gives Liquid Glass headers the system font and does not
 * read `navigationFonts`, so a screen that sets `headerTitleStyle` adds this font. Android headers
 * still read the theme fonts.
 */
export const headerTitleFont = isIOS ? navigationFonts.bold : {};

/** Stack `screenOptions` that keep the app font in iOS headers, with the weights of `navigationFonts`. */
export const headerFontOptions = isIOS
  ? {
      headerTitleStyle: headerTitleFont,
      headerLargeTitleStyle: navigationFonts.heavy,
      headerBackTitleStyle: { fontFamily: APP_FONT },
    }
  : {};
