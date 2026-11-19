import { useReducedMotion as useSystemReducedMotion } from "react-native-reanimated";
import { type MotionPreference, useMotionPreferences } from "../../features/settings/model/motion";

export function useReducedMotion(): boolean {
  const system = useSystemReducedMotion();
  const animations = useMotionPreferences((state) => state.allAnimations);
  return system || !animations;
}

export type TransitionMode = "blur" | "fade" | "none";

export function useTransitionMode(name: Exclude<MotionPreference, "allAnimations">): TransitionMode {
  const reduced = useReducedMotion();
  const enabled = useMotionPreferences((state) => state[name]);
  if (!enabled) return "none";
  return reduced ? "fade" : "blur";
}

export function useMotionPreference(name: Exclude<MotionPreference, "allAnimations">): boolean {
  const reduced = useReducedMotion();
  const enabled = useMotionPreferences((state) => state[name]);
  return enabled && !reduced;
}
