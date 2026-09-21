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
// The JS backdrop owns the fade and respects system reduced motion. Avoid two
// overlapping transitions. `setOptions` warns in Expo Go.
if (!isRunningInExpoGo()) SplashScreen.setOptions({ fade: false });

export const nativeSplash: SplashController = {
  hide: () => SplashScreen.hide(),
};
