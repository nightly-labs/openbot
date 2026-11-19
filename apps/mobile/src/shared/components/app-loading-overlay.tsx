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
  isLoaderPresent: boolean;
}

const AppLoadingOverlayContext = createContext<AppLoadingOverlayContextValue | null>(null);

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

  return <AppLoadingOverlayContext.Provider value={value}>{children}</AppLoadingOverlayContext.Provider>;
}

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
