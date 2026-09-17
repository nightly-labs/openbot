import { isRunningInExpoGo } from "expo";
import * as SplashScreen from "expo-splash-screen";

import type { SplashController } from "./use-splash-gate";

// The native splash can only paint a flat color and the app mark; the wallpaper
// exists solely in the JS backdrop. A release build reaches its first frame long
// before the wallpaper has decoded, so letting expo-router hide the native splash
// there hands off to the flat backdrop color and the artwork is never seen. Expo
// Go starts slowly enough to hide that race, an installed build does not. Claim
// the splash at module scope - expo-router defers its own claim by a tick so an
// app-level call wins - and release it from useSplashGate instead.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);
// Cross-fade into the backdrop, so the wallpaper appears behind a mark that does
// not move. `setOptions` is a development-build API and warns in Expo Go.
if (!isRunningInExpoGo()) SplashScreen.setOptions({ duration: 250, fade: true });

export const nativeSplash: SplashController = {
  hide: () => SplashScreen.hide(),
};
