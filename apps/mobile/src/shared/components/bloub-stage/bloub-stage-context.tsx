import {
  createContext,
  type PropsWithChildren,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { type SharedValue, useSharedValue, withTiming } from "react-native-reanimated";

import { SPLASH_EASE_OUT } from "@/shared/lib/splash-motion";
import { type BloubStageRequest, type BloubStageStore, createBloubStageStore } from "./bloub-stage-store";

interface BloubStageContextValue {
  store: BloubStageStore;
  lift: SharedValue<number>;
  gazeX: SharedValue<number>;
  gazeY: SharedValue<number>;
}

const BloubStageContext = createContext<BloubStageContextValue | null>(null);

const GAZE = { duration: 240, easing: SPLASH_EASE_OUT };

export function BloubStageProvider({ children }: PropsWithChildren) {
  const [store] = useState(createBloubStageStore);
  const lift = useSharedValue(0);
  const gazeX = useSharedValue(0);
  const gazeY = useSharedValue(0);
  const value = useMemo(() => ({ store, lift, gazeX, gazeY }), [gazeX, gazeY, lift, store]);
  return <BloubStageContext.Provider value={value}>{children}</BloubStageContext.Provider>;
}

export function useBloubStage(): BloubStageContextValue & { look: (x: number, y: number) => void } {
  const value = useContext(BloubStageContext);
  if (!value) throw new Error("useBloubStage requires BloubStageProvider.");
  const { gazeX, gazeY } = value;
  return useMemo(
    () => ({
      ...value,
      look: (x: number, y: number) => {
        gazeX.set(withTiming(x, GAZE));
        gazeY.set(withTiming(y, GAZE));
      },
    }),
    [gazeX, gazeY, value],
  );
}

export function useBloubStageRequest(request: BloubStageRequest | null, priority: number): boolean {
  const { store } = useBloubStage();
  const id = useId();
  const active = useSyncExternalStore(store.subscribe, () => store.active()?.id === id);
  useLayoutEffect(() => {
    if (request) store.set(id, priority, request);
    else store.remove(id);
  });
  useLayoutEffect(() => () => store.remove(id), [id, store]);
  return active;
}
