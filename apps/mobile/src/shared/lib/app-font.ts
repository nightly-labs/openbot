import type { DefaultTheme } from "expo-router/react-navigation";
import { isIOS } from "@/shared/lib/platform";

export const APP_FONT = "Inter";

export const navigationFonts = {
  regular: { fontFamily: APP_FONT, fontWeight: "400" },
  medium: { fontFamily: APP_FONT, fontWeight: "500" },
  bold: { fontFamily: APP_FONT, fontWeight: "600" },
  heavy: { fontFamily: APP_FONT, fontWeight: "700" },
} as const satisfies typeof DefaultTheme.fonts;

export const headerTitleFont = isIOS ? navigationFonts.bold : {};

export const headerFontOptions = isIOS
  ? {
      headerTitleStyle: headerTitleFont,
      headerLargeTitleStyle: navigationFonts.heavy,
      headerBackTitleStyle: { fontFamily: APP_FONT },
    }
  : {};
