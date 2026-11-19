import { isLiquidGlassAvailable } from "expo-glass-effect";
import { useReducedTransparency } from "./use-reduced-transparency";

export function useLiquidGlass(): boolean {
  const reducedTransparency = useReducedTransparency();
  return isLiquidGlassAvailable() && !reducedTransparency;
}
