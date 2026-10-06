import { isLiquidGlassAvailable } from "expo-glass-effect";
import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * Whether glass controls can draw as glass: the system has Liquid Glass and Reduce Transparency
 * is off. Until the setting is known, controls draw solid, as with Reduce Transparency on.
 */
export function useLiquidGlass(): boolean {
  const [reducedTransparency, setReducedTransparency] = useState(true);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceTransparencyEnabled().then(
      (value) => {
        if (mounted) setReducedTransparency(value);
      },
      () => {
        if (mounted) setReducedTransparency(false);
      },
    );
    const subscription = AccessibilityInfo.addEventListener("reduceTransparencyChanged", setReducedTransparency);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);
  return isLiquidGlassAvailable() && !reducedTransparency;
}
