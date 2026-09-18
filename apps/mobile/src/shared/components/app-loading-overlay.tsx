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
import { BackHandler, View } from "react-native";
import { BloubLoader } from "@/shared/components/bloub-loader";

interface AppLoadingOverlayContextValue {
  setLoadingLabel: (label: string | null) => void;
  isLoaderPresent: boolean;
}

const AppLoadingOverlayContext = createContext<AppLoadingOverlayContextValue | null>(null);
// The exit animation reports its own end, and that report blocks the app until it
// arrives. A lost animation callback, or a loader unmounted part way through its
// exit, left the loader over the conversation with no way back. Longer than the
// whole exit takes, so a healthy exit still owns its own timing.
const EXIT_DEADLINE_MS = 2000;

export function AppLoadingOverlayProvider({ children }: PropsWithChildren) {
  // Starts idle: the splash backdrop covers account loading on its own, so no
  // loader is present until a screen raises one with setLoadingLabel.
  const [{ label, present }, setOverlay] = useState<{ label: string | null; present: boolean }>({
    label: null,
    present: false,
  });
  const visible = label !== null;
  const setLoadingLabel = useCallback((nextLabel: string | null) => {
    setOverlay((current) =>
      current.label === nextLabel
        ? current
        : {
            label: nextLabel,
            present: nextLabel !== null || current.present,
          },
    );
  }, []);
  const handleExitComplete = useCallback(() => {
    setOverlay((current) => (current.label === null && current.present ? { ...current, present: false } : current));
  }, []);
  const value = useMemo(() => ({ setLoadingLabel, isLoaderPresent: present }), [present, setLoadingLabel]);

  useEffect(() => {
    if (!present) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => subscription.remove();
  }, [present]);

  useEffect(() => {
    if (visible || !present) return;
    const deadline = setTimeout(handleExitComplete, EXIT_DEADLINE_MS);
    return () => clearTimeout(deadline);
  }, [handleExitComplete, present, visible]);

  return (
    <AppLoadingOverlayContext.Provider value={value}>
      <View className="flex-1">
        <View
          className="flex-1"
          pointerEvents={present ? "none" : "auto"}
          accessibilityElementsHidden={present}
          importantForAccessibility={present ? "no-hide-descendants" : "auto"}
        >
          {children}
        </View>
        <View
          className="absolute inset-0 items-center justify-center"
          pointerEvents={present ? "auto" : "none"}
          accessibilityElementsHidden={!present}
          importantForAccessibility={present ? "auto" : "no-hide-descendants"}
        >
          {/* Keep the native SVG mounted across account loading and workspace navigation. */}
          <BloubLoader
            active={visible}
            visible={visible}
            label={label ?? "Loading"}
            onExitComplete={handleExitComplete}
          />
        </View>
      </View>
    </AppLoadingOverlayContext.Provider>
  );
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
