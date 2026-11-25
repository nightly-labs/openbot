import { isRunningInExpoGo } from "expo";
import * as SplashScreen from "expo-splash-screen";

import type { SplashController } from "./use-splash-gate";

void SplashScreen.preventAutoHideAsync().catch(() => undefined);
if (!isRunningInExpoGo()) SplashScreen.setOptions({ fade: false });

export const nativeSplash: SplashController = {
  hide: () => SplashScreen.hide(),
};
