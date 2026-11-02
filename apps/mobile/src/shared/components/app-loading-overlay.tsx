import { useIsFocused, usePathname } from "expo-router";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { BackHandler } from "react-native";

import { useBloubStageRequest } from "@/shared/components/bloub-stage/bloub-stage-context";
import { BLOUB_PRIORITY } from "@/shared/components/bloub-stage/bloub-stage-store";

interface AppLoadingOverlayContextValue {
  setLoadingLabel: (label: string | null) => void;
  /** The loader covers the app. */
  isLoaderPresent: boolean;
}

const AppLoadingOverlayContext = createContext<AppLoadingOverlayContextValue | null>(null);

/**
 * The app loader: the stage block covers the screen, the eyes think, and the label shows at the
 * bottom. When the label clears, the block rolls up and the screen below comes in under it.
 */
export function AppLoadingOverlayProvider({ children }: PropsWithChildren) {
  const [label, setLabel] = useState<string | null>(null);
  const setLoadingLabel = useCallback((next: string | null) => setLabel(next), []);
  const present = label !== null;
  useBloubStageRequest(
    label !== null ? { shape: { kind: "cover" }, mood: "think", caption: { text: label }, loader: true } : null,
    BLOUB_PRIORITY.loader,
  );
  const value = useMemo(() => ({ setLoadingLabel, isLoaderPresent: present }), [present, setLoadingLabel]);

  useEffect(() => {
    if (!present) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => subscription.remove();
  }, [present]);

  // The root navigator blocks the app below while the loader is present.
  return <AppLoadingOverlayContext.Provider value={value}>{children}</AppLoadingOverlayContext.Provider>;
}

// Hold the app loading label for one screen, while that screen is the route on top.
// The overlay blocks the whole app, and a screen stays mounted under a pushed chat,
// so ownership needs the route as well as focus: a late focus report from the screen
// below must never raise a blocking loader over the conversation.
export function useScreenLoadingLabel(route: string, label: string | null) {
  const { setLoadingLabel } = useAppLoadingOverlay();
  const isFocused = useIsFocused();
  const pathname = usePathname();
  const ownsOverlay = isFocused && pathname === route;

  useLayoutEffect(() => {
    if (!ownsOverlay) return;
    setLoadingLabel(label);
    return () => setLoadingLabel(null);
  }, [label, ownsOverlay, setLoadingLabel]);
}

export function useAppLoadingOverlay() {
  const value = useContext(AppLoadingOverlayContext);
  if (!value) throw new Error("useAppLoadingOverlay requires AppLoadingOverlayProvider.");
  return value;
}
