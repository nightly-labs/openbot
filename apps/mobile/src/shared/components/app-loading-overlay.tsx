import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { BackHandler, View } from "react-native";
import { BloubLoader } from "@/shared/components/bloub-loader";

interface AppLoadingOverlayContextValue {
  setLoadingLabel: (label: string | null) => void;
  isLoaderPresent: boolean;
}

const AppLoadingOverlayContext = createContext<AppLoadingOverlayContextValue | null>(null);
export function AppLoadingOverlayProvider({ children }: PropsWithChildren) {
  const [{ label, present }, setOverlay] = useState<{ label: string | null; present: boolean }>({
    label: "Loading account",
    present: true,
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

export function useAppLoadingOverlay() {
  const value = useContext(AppLoadingOverlayContext);
  if (!value) throw new Error("useAppLoadingOverlay requires AppLoadingOverlayProvider.");
  return value;
}
