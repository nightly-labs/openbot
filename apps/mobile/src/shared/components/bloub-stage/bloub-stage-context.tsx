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
  /** Points the header moves up by, such as to keep a field above the keyboard. A worklet may set it. */
  lift: SharedValue<number>;
  /** Where the eyes look, in points of the eye box. Set it with `look`. */
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
      // A screen sets the gaze when its state changes, never per frame.
      look: (x: number, y: number) => {
        gazeX.set(withTiming(x, GAZE));
        gazeY.set(withTiming(y, GAZE));
      },
    }),
    [gazeX, gazeY, value],
  );
}

/**
 * Asks the stage to show `request` while this component is mounted. `null` withdraws it. Returns
 * true while the stage shows this request.
 */
export function useBloubStageRequest(request: BloubStageRequest | null, priority: number): boolean {
  const { store } = useBloubStage();
  const id = useId();
  // Only a change of this request's own state renders the requester again.
  const active = useSyncExternalStore(store.subscribe, () => store.active()?.id === id);
  // The store compares the request, so a render that changes nothing on the stage costs nothing.
  useLayoutEffect(() => {
    if (request) store.set(id, priority, request);
    else store.remove(id);
  });
  useLayoutEffect(() => () => store.remove(id), [id, store]);
  return active;
}
